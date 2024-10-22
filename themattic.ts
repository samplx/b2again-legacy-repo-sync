#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net
/*
 *  Copyright 2024 James Burlingame
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */
'use strict';

import {
    DownloadErrorInfo,
    downloadFile,
    DownloadFileInfo,
    getHrefListFromPage,
    GroupDownloadInfo,
    readDownloadStatus,
    saveDownloadStatus,
    mergeDownloadInfo
} from "./lib/downloads.ts";
import { printSplitSummary, splitFilename } from "./lib/split-filename.ts";
import { parseArgs, ParseOptions } from "jsr:@std/cli/parse-args";
import * as path from "jsr:@std/path";
import { migrateThemeInfo, ThemeInfo } from "./lib/themes.ts";
import { ConsoleReporter, VERBOSE_CONSOLE_REPORTER, QUIET_CONSOLE_REPORTER } from "./lib/reporter.ts";
import { parse } from "jsr:@std/jsonc";

/** how the script describes itself. */
const PROGRAM_NAME: string = 'themattic';
/** current semver */
const VERSION: string = '0.2.0';

/** default number of items processed between saves of the status file. */
const DEFAULT_PACE: number = 25;

/**
 * How to report non-errors.
 */
let reporter: ConsoleReporter = VERBOSE_CONSOLE_REPORTER;

/**
 * How to report verbose messages.
 */
let vreporter: ConsoleReporter = QUIET_CONSOLE_REPORTER;

/**
 * A simple Either-like structure to capture the results of a download.
 */
type ThemeDownloadResult = DownloadErrorInfo & ThemeInfo;

type ThemeBrowseOptions = 'featured' | 'new' | 'popular' | 'updated';

type ThemeListOptions =
    'featured' | 'new' | 'popular' | 'updated' | 'defaults' | 'interesting' | 'subversion';

type ThemeLists = Record<string, Array<ThemeInfo>>;

interface QueryThemesInfo {
    page: number,
    pages: number,
    results: number
}

interface QueryThemesResult {
    info?: QueryThemesInfo;
    themes: Array<ThemeInfo>;
}

/**
 * Results of parsing the command-line.
 */
interface CommandOptions {
    /** where to get information */
    apiHost: string;

    /** top-level directory where build results are to be stored. */
    documentRoot: string;

    /** URL address of the base of the download tree. */
    downloadsBaseUrl: string;

    /** where to get themes */
    downloadsHost: string;

    /** true to force download of all files. */
    force: boolean;

    /** true if all files should be downloaded. */
    full: boolean;

    /** true if user requested help. */
    help: boolean;

    /** name of a file containing the 'interesting' subset of themes. */
    interestingFilename: string;

    /** spaces when rendering JSON. */
    jsonSpaces: string;

    /** maximum number of themes in list (as an optional string). */
    limit?: string;

    /** which list are we using. */
    list: ThemeListOptions;

    /** if true, query API for lists of themes, and report on them. */
    lists: boolean;

    /** name of JSON file containing the lists from the API server. */
    listsFilename: string;

    /** number of items processed between saves of the status file (as a string). */
    pace: string;

    /** how many characters to put in the directory prefix (as a string). */
    prefixLength: string;

    /** if true, only report errors. */
    quiet: boolean;

    /** where to get sources */
    repoHost: string;

    /** true if failures should be retried. */
    retry: boolean;

    /** name of JSON file containing the download status. */
    statusFilename: string;

    /** URL address of the support server. */
    supportBaseUrl: string;

    /** flag indicating an update operation. */
    update: boolean;

    /** flag indicating more verbose output is desired. */
    verbose: boolean;

    /** flag indicating a request to print the version. */
    version: boolean;

    /**
     * a "hidden" flag used for debugging/testing.
     * If true, use a fixed list of theme slugs rather
     * than the large list from the subversion page.
     */
    DEBUG_USE_FIXED_THEME_SLUGS: boolean;

    /** rest of the arguments of the command-line. */
    _: Array<string>;
}


const parseOptions: ParseOptions = {
    default: {
        apiHost: 'api.wordpress.org',
        documentRoot: 'build',
        downloadsBaseUrl: 'https://downloads.b2again.org/',
        downloadsHost: 'downloads.wordpress.org',
        force: false,
        full: false,
        help: false,
        interestingFilename: 'interesting-themes.jsonc',
        jsonSpaces: '    ',
        list: 'updated',
        lists: false,
        listsFilename: 'legacy-lists.json',
        pace: `${DEFAULT_PACE}`,
        prefixLength: '2',
        quiet: false,
        repoHost: 'themes.svn.wordpress.org',
        retry: false,
        statusFilename: 'themes-status.json',
        supportBaseUrl: 'https://support.b2again.org/',
        update: false,
        verbose: false,
        version: false,
        DEBUG_USE_FIXED_THEME_SLUGS: false,
    },
    boolean: [
        'force',
        'full',
        'help',
        'lists',
        'quiet',
        'retry',
        'update',
        'version',
        'verbose',
        'DEBUG_USE_FIXED_THEME_SLUGS'
    ],
    string: [
        'apiHost',
        'documentRoot',
        'downloadsHost',
        'interestingFilename',
        'jsonSpaces',
        'limit',
        'list',
        'listsFilename',
        'pace',
        'prefixLength',
        'repoHost',
        'statusFilename',
        'downloadsBaseUrl',
        'supportBaseUrl'
    ],
    unknown: (arg: string): unknown => {
        console.error(`Warning: unrecognized option ignored '${arg}'`);
        return false;
    }
}

/**
 * Handle the downloading and processing of a single theme.
 * @param options command-line options.
 * @param prefixLength number of characters to use in the directory prefix.
 * @param slug theme slug.
 * @returns
 */
async function processTheme(
        options: CommandOptions,
        prefixLength: number,
        slug: string,
        outdated: boolean,
        fromAPI: ThemeInfo
    ): Promise<GroupDownloadInfo> {
    const themeReadOnlyDir = path.join(options.documentRoot, 'themes', 'read-only', 'legacy', splitFilename(slug, prefixLength));
    const themeMetaDir = path.join(options.documentRoot, 'themes', 'meta', 'legacy', splitFilename(slug, prefixLength));
    const themeLiveDir = path.join(options.documentRoot, 'themes', 'live', 'legacy', splitFilename(slug, prefixLength));

    const files: Record<string, DownloadFileInfo> = {};
    const infoUrl = getThemeInfoUrl(options.apiHost, slug);
    let ok = true;
    let last_updated_time;
    try {
        vreporter(`> mkdir -p ${themeReadOnlyDir}`);
        await Deno.mkdir(themeReadOnlyDir, { recursive: true });
        vreporter(`> mkdir -p ${themeMetaDir}`);
        await Deno.mkdir(themeMetaDir, { recursive: true });

        const themeInfo = await handleThemeInfo(options, themeLiveDir, themeMetaDir, themeReadOnlyDir, infoUrl, outdated || options.force, fromAPI);
        if (themeInfo) {
            if ((typeof themeInfo.slug !== 'string') ||
                (typeof themeInfo.error === 'string') ||
                (typeof themeInfo.download_link !== 'string')) {
                ok = false;
            } else {
                last_updated_time = themeInfo.last_updated_time;
                const zipFilename = path.join(themeReadOnlyDir, themeInfo.download_link.substring(themeInfo.download_link.lastIndexOf('/')+1));
                const fileInfo = await downloadFile(reporter, new URL(themeInfo.download_link), zipFilename, options.force, options.update);
                ok = ok && (fileInfo.status === 'full');
                files[fileInfo.filename] = fileInfo;
                if (options.full) {
                    if (typeof themeInfo.preview_url === 'string') {
                        // preview_url
                        const previewDir = path.join(themeLiveDir, 'preview');
                        vreporter(`> mkdir -p ${previewDir}`);
                        await Deno.mkdir(previewDir, { recursive: true });
                        const previewIndex = path.join(previewDir, 'index.html');
                        const previewInfo = await downloadFile(reporter, new URL(themeInfo.preview_url), previewIndex, options.force, options.update);
                        ok = ok && (previewInfo.status === 'full');
                        files[previewInfo.filename] = previewInfo;
                    }
                    if (typeof themeInfo.screenshot_url === 'string') {
                        // screenshot_url
                        const screenshotsDir = path.join(themeLiveDir, 'screenshots');
                        vreporter(`> mkdir -p ${screenshotsDir}`);
                        await Deno.mkdir(screenshotsDir, { recursive: true });
                        // some ts.w.org URL's don't have a scheme?
                        const screenshotUrl = new URL(themeInfo.screenshot_url.startsWith('//') ? `https:${themeInfo.screenshot_url}` : themeInfo.screenshot_url);
                        const screenshotFile = path.join(screenshotsDir,
                            screenshotUrl.pathname.substring(screenshotUrl.pathname.lastIndexOf('/')+1));
                        const screenshotInfo = await downloadFile(reporter, screenshotUrl, screenshotFile, options.force, options.update);
                        ok = ok && (screenshotInfo.status === 'full');
                        files[screenshotInfo.filename] = screenshotInfo;
                    }
                    if (typeof themeInfo.versions === 'object') {
                        for (const version in themeInfo.versions) {
                            if (version !== 'trunk') {
                                const fileInfo = await downloadThemeZip(options, themeInfo.versions[version], themeReadOnlyDir);
                                files[fileInfo.filename] = fileInfo;
                                ok = ok && (fileInfo.status === 'full');
                            }
                        }
                    }
                }
            }
        }
    } catch (_) {
        console.error(`Exception: ${_}`);
        ok= false;
    }

    return {
        status: ok ? (options.full ? 'full' : 'partial') : 'failed',
        when: Date.now(),
        files,
        last_updated_time
    };
}

/**
 * Determine the URL to use to request theme information.
 * @param apiHost where the API is.
 * @param name slug used to access the theme.
 * @returns
 */
function getThemeInfoUrl(apiHost: string, name: string): URL {
    const url = new URL('/themes/info/1.2/', `https://${apiHost}`);
    url.searchParams.append('action', 'theme_information');
    url.searchParams.append('slug', name);
    url.searchParams.append('fields[]','description');
    url.searchParams.append('fields[]','versions');
    url.searchParams.append('fields[]','ratings');
    url.searchParams.append('fields[]','active_installs');
    url.searchParams.append('fields[]','sections');
    url.searchParams.append('fields[]','parent');
    url.searchParams.append('fields[]','template');
    return url;
}

/**
 * Extract a list of themes from an HTML page.
 * @param listUrl where to access the theme list
 * @returns list of theme slugs.
 */
async function getThemeSlugs(listUrl: string, fixedList: boolean = false): Promise<Array<string>> {
    if (fixedList) {
        return [
            '100-bytes',
            'acid-rain',
            decodeURIComponent('%e6%a0%bc%e5%ad%90-x') // unicode -- not found
        ];
    }
    const rawList = await getHrefListFromPage(reporter, listUrl);
    const themeNames =
        rawList
            .filter(n => (n !== '..') && (n !== '../'))
            .map(n => decodeURIComponent(n.slice(0, -1)));
    return themeNames;
}


/**
 * Download a zip file, if required.
 * @param sourceUrl where to download the zip file.
 * @param themeDir where to put the zip file.
 * @returns true if download was successful, false if not.
 */
async function downloadThemeZip(options: CommandOptions, sourceUrl: string, themeDir: string): Promise<DownloadFileInfo> {
    const zipFilename = path.join(themeDir, sourceUrl.substring(sourceUrl.lastIndexOf('/')+1));
    try {
        await Deno.chmod(zipFilename, 0o644);
    } catch (_) {
        // ignored, wait for download to fail.
    }
    const info = await downloadFile(reporter, new URL(sourceUrl), zipFilename, options.force, options.update);
    try {
        await Deno.chmod(zipFilename, 0o444);
    } catch (_) {
        reporter(`Warning: chmod(${zipFilename}, 0o444) failed`);
    }
    return info;
}

/**
 * Download the theme information JSON file, if necessary. The download
 * may be forced by setting the force parameter. If the file does not
 * exist, we will attempt to download the file.
 * @param themeDir where to put the json file.
 * @param infoUrl where to get the json file.
 * @param force if true, remove any old file first.
 * @returns
 */
async function handleThemeInfo(
    options: CommandOptions,
    themeLiveDir: string,
    themeMetaDir: string,
    themeReadOnlyDir: string,
    infoUrl: URL,
    force: boolean,
    fromAPI: ThemeInfo
): Promise<ThemeDownloadResult> {
    const themeJson = path.join(themeMetaDir, 'theme.json');
    const legacyThemeJson = path.join(themeMetaDir, 'legacy-theme.json');
    try {
        if (force) {
            await Deno.remove(themeJson, { recursive: true });
            await Deno.remove(legacyThemeJson, { recursive: true });
        }
        const contents = await Deno.readTextFile(legacyThemeJson);
        return JSON.parse(contents);
    } catch (_) {
        reporter(`fetch(${infoUrl}) > ${legacyThemeJson}`);
        const response = await fetch(infoUrl);
        if (!response.ok) {
            const error = `${response.status} ${response.statusText}`;
            reporter(`fetch failed: ${error}`);
            return { error };
        }
        const json = await response.json();
        const rawText = JSON.stringify(json, null, options.jsonSpaces);
        const migrated = migrateThemeInfo(options.downloadsBaseUrl, options.supportBaseUrl, themeLiveDir, themeReadOnlyDir, json, fromAPI);
        const text = JSON.stringify(migrated, null, options.jsonSpaces);
        await Deno.writeTextFile(themeJson, text);
        await Deno.writeTextFile(legacyThemeJson, rawText);
        return json;
    }
}

/**
 * Download all of the theme files.
 * @param options command-line options.
 * @param prefixLength number of characters in prefix of split filename.
 * @param themeSlugs list of plugin slugs.
 */
async function downloadFiles(options: CommandOptions, prefixLength: number, themeSlugs: Array<string>, themeList: Array<ThemeInfo>): Promise<void> {
    const statusFilename = path.join(options.documentRoot, 'themes', 'meta', options.statusFilename);
    const status = await readDownloadStatus(statusFilename, themeSlugs);
    let ok: boolean = true;
    let soFar: number = 0;
    let success: number = 0;
    let failure: number = 0;
    let skipped: number = 0;
    let needed: boolean = false;
    let outdated: boolean = false;
    let changed: boolean = false;
    let pace: number = parseInt(options.pace);
    if (isNaN(pace)) {
        pace = DEFAULT_PACE;
        console.error(`Warning: unable to parse ${options.pace} as an integer. default ${pace} is used`);
    }
    // go through and mark themes for which we are no longer interested.
    for (const slug in status.map) {
        if (!themeSlugs.includes(slug)) {
            status.map[slug].status = 'uninteresting';
        }
    }
    for (const item of themeList) {
        if (typeof item.slug !== 'string') {
            continue;
        }
        const slug = item.slug;
        needed = false;
        outdated = false;
        if (typeof status.map[slug] !== 'object') {
            status.map[slug] = { status: 'unknown', when: 0, files: {} };
        }
        if ((typeof status.map[slug] === 'object') &&
            (typeof status.map[slug]?.status === 'string') &&
            (typeof status.map[slug]?.when === 'number')) {

            // check to see if the data we have is out of date.
            if ((typeof status.map[slug]?.last_updated_time === 'string') &&
                (typeof item?.last_updated_time === 'string') &&
                (status.map[slug].last_updated_time < item.last_updated_time)) {
                status.map[slug].status = 'outdated';
            }
            // determine if we need this theme
            switch (status.map[slug]?.status) {
                case 'unknown':
                    needed = true;
                    break;
                case 'partial':
                    needed = options.full;
                    break;
                case 'full':
                case 'uninteresting':
                    needed = false;
                    break;
                case 'failed':
                    needed = options.retry;
                    break;
                case 'outdated':
                    needed = true;
                    outdated = true;
                    break;
                default:
                    console.error(`Error: unrecognized status. slug=${slug}, status=${status.map[slug]?.status}`);
                    break;
            }
            soFar += 1;
            if (needed || options.force || outdated) {
                const themeStatus = await processTheme(options, prefixLength, slug, outdated, item);
                changed = true;
                if ((themeStatus.status === 'full') || (themeStatus.status === 'partial')) {
                    success += 1;
                } else if (themeStatus.status === 'failed') {
                    failure += 1;
                } else {
                    console.error(`Warning: unknown status after processTheme: slug=${slug}`);
                }
                const existing = status.map[slug].files;
                status.map[slug].status = themeStatus.status;
                status.map[slug].when = themeStatus.when;
                status.map[slug].last_updated_time = themeStatus.last_updated_time;
                status.map[slug].files = {};
                for (const name in themeStatus.files) {
                    status.map[slug].files[name] = mergeDownloadInfo(existing[name], themeStatus.files[name]);
                }
                ok = ok && (themeStatus.status !== 'failed');
            } else {
                skipped += 1;
                if ((status.map[slug]?.status === 'full') || (status.map[slug]?.status === 'partial')) {
                    success += 1;
                } else if (status.map[slug]?.status === 'failed') {
                    failure += 1;
                }
            }
        } else {
            console.error(`Error: unknown status: slug=${slug}`);
        }
        if ((soFar % pace) == 0) {
            if (changed) {
                reporter(`save status > ${statusFilename}`);
                ok = await saveDownloadStatus(statusFilename, status) && ok;
            }
            changed = false;
            vreporter('');
            reporter(`themes processed:   ${soFar}`);
            vreporter(`successful:         ${success}`);
            vreporter(`failures:           ${failure}`);
            vreporter(`skipped:            ${skipped}`);
        }
    }
    status.when = Date.now();
    reporter(`save status > ${statusFilename}`);
    ok = await saveDownloadStatus(statusFilename, status) && ok;

    reporter(`Total themes processed:   ${soFar}`);
    reporter(`Total successful:         ${success}`);
    reporter(`Total failures:           ${failure}`);
    reporter(`Total skipped:            ${skipped}`);
}

/**
 * Determine the URL to use to query a themes list.
 * @param apiHost where the API is.
 * @param pageNumber which page of data requested.
 * @param [browse=undefined] browse parameter to query_themes request (if any).
 * @returns
 */
function getThemeListUrl(apiHost: string, pageNumber: number = 1, browse: undefined | ThemeBrowseOptions = undefined): URL {
    const url = new URL('/themes/info/1.2/', `https://${apiHost}`);
    url.searchParams.append('action', 'query_themes');
    url.searchParams.append('fields[]','description');
    url.searchParams.append('fields[]','ratings');
    url.searchParams.append('fields[]','active_installs');
    url.searchParams.append('fields[]','sections');
    url.searchParams.append('fields[]','parent');
    url.searchParams.append('fields[]','template');
    url.searchParams.append('per_page', '100');
    url.searchParams.append('page', `${pageNumber}`);
    if (browse) {
        url.searchParams.append('browse', browse);
    }
    return url;
}

/**
 * Query the API server for a list of theme information.
 * @param apiHost hostname to query for theme information.
 * @param browse what kind of information to request.
 * @returns list of theme information.
 */
async function getAPIThemeList(apiHost: string, browse: undefined | ThemeBrowseOptions): Promise<Array<ThemeInfo>> {
    const collection: Array<ThemeInfo> = [];
    let pages: number = 1;
    let page: number = 1;
    while (page <= pages) {
        const url = getThemeListUrl(apiHost, page, browse);
        vreporter(`fetch(${url})`);
        const response = await fetch(url);
        if (response.ok) {
            const json = await response.json();
            if ((typeof json.info === 'object') && (typeof json.info.pages === 'number')) {
                pages = json.info.pages;
            }
            if (Array.isArray(json.themes)) {
                collection.push(...json.themes);
            }
        }
        page += 1;
    }
    return collection;
}

/**
 * Read a JSON w/comments file that contains an array of theme slugs.
 * @param options command-line options.
 * @returns list of theme information.
 */
async function getInterestingList(options: CommandOptions): Promise<Array<ThemeInfo>> {
    const list: Array<ThemeInfo> = [];
    const contents = await Deno.readTextFile(options.interestingFilename);
    const jsonc = parse(contents) as unknown;
    if (!Array.isArray(jsonc)) {
        console.error(`Error: JSON w/comments in ${options.interestingFilename} is not an Array.`);
        reporter(`Note: file should be in JSON format, not just a list of slugs.`);
    } else {
        for (let n=0; n < jsonc.length; n++) {
            if (typeof jsonc[n] === 'string') {
                list.push({ slug: jsonc[n] });
            }
        }
    }
    return list;
}

/**
 * Query the API server to get a list of theme information.
 * @param apiHost where to get the list of themes.
 * @param browse what kind of request.
 * @returns list of theme's information.
 */
async function getUnlimitedThemeList(options: CommandOptions, kind: ThemeListOptions): Promise<Array<ThemeInfo>> {
    if (kind === 'subversion') {
        const slugs = await getThemeSlugs(`http://${options.repoHost}/`, options.DEBUG_USE_FIXED_THEME_SLUGS);
        const list: Array<ThemeInfo> = [];
        slugs.forEach((slug) => list.push({slug}));
        return list;
    }
    if (kind === 'interesting') {
        return await getInterestingList(options);
    }
    if (kind === 'defaults') {
        return await getAPIThemeList(options.apiHost, undefined);
    }
    return await getAPIThemeList(options.apiHost, kind);
}

/**
 * Query the API server to get list of theme information. Impose
 * any optional limit on the number of entires.
 * @param options where to get the list of themes.
 * @param kind what kind of request.
 * @returns list of theme's information possiblily limited.
 */
async function getThemeList(options: CommandOptions, kind: ThemeListOptions): Promise<Array<ThemeInfo>> {
    const list = await getUnlimitedThemeList(options, kind);
    if (options.limit) {
        const limit = parseInt(options.limit);
        if (isNaN(limit)) {
            console.error(`Warning: unable to parse limit=${options.limit}, it is ignored.`);
        } else if (list.length > limit) {
            return list.slice(0, limit);
        }
    }
    return list;
}

/**
 * Extract a list of themes from an HTML page.
 * @param listUrl where to access the theme list
 * @returns list of theme slugs.
 */
async function getThemeLists(options: CommandOptions): Promise<ThemeLists> {
    const subversion = await getThemeList(options, 'subversion');
    const defaults = await getThemeList(options, 'defaults');
    const featured = await getThemeList(options, 'featured');
    const introduced = await getThemeList(options, 'new');
    const popular = await getThemeList(options, 'popular');
    const updated = await getThemeList(options, 'updated');
    let interesting: Array<ThemeInfo> = [];
    if (options.list === 'interesting') {
        interesting = await getThemeList(options, 'interesting');
    }

    return {
        'defaults': defaults,
        'featured': featured,
        'interesting': interesting,
        'new': introduced,
        'popular': popular,
        'subversion': subversion,
        'updated': updated
    };
}

/**
 *
 * @param list1 list of theme information.
 * @param list2 another list of theme information.
 * @returns number of slugs in list1 that are also in list2.
 */
// function intersectionCount(list1: Array<ThemeInfo>, list2: Array<ThemeInfo>): number {
//     const map: Record<string, boolean> = {};
//     list2.forEach((info: ThemeInfo) => {
//         if (typeof info?.slug === 'string') {
//             map[info.slug] = true;
//         }
//     });
//     let count: number = 0;
//     list1.forEach((info: ThemeInfo) => {
//         if ((typeof info?.slug === 'string') && map[info.slug]) {
//             count += 1;
//         }

//     });
//     return count;
// }

function themeListsReport(lists: ThemeLists) {
    const keys: Array<string> = [];
    reporter(`list name(count)`);
    for (const name in lists) {
        if (Array.isArray(lists[name])) {
            reporter(`    ${name}(${lists[name].length})`);
            keys.push(name);
        }
    }
    // const intersections: Record<string, Record<string, number | string>> = {};

    // for (const outer of keys) {
    //     intersections[outer] = {};
    //     for (const inner of keys) {
    //         if (outer === inner) {
    //             intersections[outer][inner] = `=${lists[inner].length}`;
    //         } else {
    //             intersections[outer][inner] = intersectionCount(lists[inner], lists[outer]);
    //         }
    //     }
    // }
    // const json = JSON.stringify(intersections, null, '    ');

    // const updatedSlugs: Array<string> = [];
    // const newSlugs: Array<string> = [];
    // if (Array.isArray(lists['new']) && Array.isArray(lists['updated'])) {
    //     lists['new'].forEach((info) => newSlugs.push(`${info.slug}`));
    //     lists['updated'].forEach((info) => updatedSlugs.push(`${info.slug}`));
    //     let matching = true;
    //     for (let n: number = 0; n < newSlugs.length; n++) {
    //         if (newSlugs[n] !== updatedSlugs[n]) {
    //             reporter(`new and updated failed to match @${n}`);
    //             matching = false;
    //             break;
    //         }
    //     }
    //     if (matching) {
    //         reporter(`new and updated lists match`);
    //     }
    // }

    // reporter(json);
}

async function saveThemeLists(options: CommandOptions, lists: ThemeLists): Promise<void> {
    const text = JSON.stringify(lists, null, options.jsonSpaces);
    const dirname = path.join(options.documentRoot, 'themes', 'meta');
    await Deno.mkdir(dirname, { recursive: true });
    const filename = path.join(dirname, options.listsFilename);
    vreporter(`save theme lists> ${filename}`);
    await Deno.writeTextFile(filename, text);
}

/**
 * Provide help to the user.
 */
function printHelp(): void {
    console.log(`${PROGRAM_NAME} [options]`);
    console.log();
    console.log(`Options include [default value]:`);
    console.log(`--apiHost=host             [${parseOptions.default?.apiHost}]`);
    console.log(`    define where to load theme data.`);
    console.log(`--documentRoot=dir         [${parseOptions.default?.documentRoot}]`);
    console.log(`    define where save files.`);
    console.log(`--downloadsBaseUrl=url     [${parseOptions.default?.downloadsBaseUrl}]`);
    console.log(`    define downstream downloads host.`);
    console.log(`--downloadsHost=host       [${parseOptions.default?.downloadsHost}]`);
    console.log(`    define where to load theme zip files.`);
    console.log(`--force                    [${parseOptions.default?.force}]`);
    console.log(`    force download of files.`);
    console.log(`--full                     [${parseOptions.default?.full}]`);
    console.log(`    full archive. include all versions, screenshots, and previews`);
    console.log(`--help`);
    console.log(`    print this message and exit.`);
    console.log(`--interestingFilename=name [${parseOptions.default?.interestingFilename}]`);
    console.log(`    JSON w/comments file of interesting theme slugs.`);
    console.log(`--jsonSpaces=spaces        [${parseOptions.default?.jsonSpaces}]`);
    console.log(`    spaces used to delimit generated JSON files.`);
    console.log(`--limit=number             [none]`);
    console.log(`    maximum number of themes in a list.`);
    console.log(`--list=kind                [${parseOptions.default?.list}]`);
    console.log(`    which list to use: subversion, defaults, featured, interesting, new, popular, updated.`);
    console.log(`--lists                    [${parseOptions.default?.lists}]`);
    console.log(`    load all theme lists and save to listsFilename.`);
    console.log(`--listsFilename=name       [${parseOptions.default?.listsFilename}]`);
    console.log(`    JSON file of lists of legacy theme information.`);
    console.log(`--pace=number              [${parseOptions.default?.pace}]`);
    console.log(`    number of items processed between status file saves.`);
    console.log(`--prefixLength=number      [${parseOptions.default?.prefixLength}]`);
    console.log(`    number of characters in directory prefix.`);
    console.log(`--quiet                    [${parseOptions.default?.quiet}]`);
    console.log(`    be quiet. supress non-error messages.`);
    console.log(`--repoHost=host            [${parseOptions.default?.repoHost}]`);
    console.log(`    define where to load list of themes from subversion.`);
    console.log(`--retry                    [${parseOptions.default?.retry}]`);
    console.log(`    retry to download failed files.`);
    console.log(`--statusFilename=name      [${parseOptions.default?.statusFilename}]`);
    console.log(`    define where to save status information.`);
    console.log(`--supportBaseUrl=url       [${parseOptions.default?.supportBaseUrl}]`);
    console.log(`    define downstream support host.`);
    console.log(`--update                   [${parseOptions.default?.update}]`);
    console.log(`    recalculate message digests (hashes).`);
    console.log(`--verbose                  [${parseOptions.default?.verbose}]`);
    console.log(`    be verbose. include more informational messages.`);
    console.log(`--version`);
    console.log(`    print program version and exit.`);
}

/**
 *
 * @param argv arguments passed after the `deno run -N pluperfect.ts`
 * @returns 0 if ok, 1 on error, 2 on usage errors.
 */
async function main(argv: Array<string>): Promise<number> {
    const options: CommandOptions = parseArgs(argv, parseOptions);

    if (options.version) {
        console.log(`${PROGRAM_NAME} version ${VERSION}`);
        return 0;
    }
    if (options.help) {
        printHelp();
        return 0;
    }
    if (options.quiet) {
        reporter = QUIET_CONSOLE_REPORTER;
    }
    if (options.verbose) {
        vreporter = VERBOSE_CONSOLE_REPORTER;
    }
    vreporter(`${PROGRAM_NAME} v${VERSION}`);
    const writeAccess = await Deno.permissions.request({ name: 'write', path: options.documentRoot});
    if (writeAccess.state !== 'granted') {
        console.error(`Error: write access is required to documentRoot ${options.documentRoot}`);
        return 1;
    }
    const buildAccess = await Deno.permissions.request({ name: 'read', path: options.documentRoot});
    if (buildAccess.state !== 'granted') {
        console.error(`Error: read access is required to documentRoot ${options.documentRoot}`);
        return 1;
    }
    const apiAccess = await Deno.permissions.request({ name: 'net', host: options.apiHost});
    if (apiAccess.state !== 'granted') {
        console.error(`Error: network access is required to apiHost ${options.apiHost}`);
        return 1;
    }
    const repoAccess = await Deno.permissions.request({ name: 'net', host: options.repoHost});
    if (repoAccess.state !== 'granted') {
        console.error(`Error: network access is required to repoHost ${options.repoHost}`);
        return 1;
    }
    const downloadsAccess = await Deno.permissions.request({ name: 'net', host: options.downloadsHost});
    if (downloadsAccess.state !== 'granted') {
        console.error(`Error: network access is required to repoHost ${options.downloadsHost}`);
        return 1;
    }
    if (options.lists) {
        const themeLists = await getThemeLists(options);
        themeListsReport(themeLists);
        await saveThemeLists(options, themeLists);
        return 0;
    }
    const themeList = await getThemeList(options, options.list);
    const themeSlugs: Array<string> = [];
    themeList.forEach((item) => { if (item.slug) { themeSlugs.push(item.slug) } });
    reporter(`themes found:      ${themeList.length}`);

    const prefixLength = parseInt(options.prefixLength);
    if (isNaN(prefixLength)) {
        console.error(`Error: prefixLength=${options.prefixLength} is not a valid integer`);
        return 2;
    }
    if (prefixLength < 0) {
        printSplitSummary(themeSlugs, 1);
        printSplitSummary(themeSlugs, 2);
        printSplitSummary(themeSlugs, 3);
        printSplitSummary(themeSlugs, 4);
        return 0;
    }

    await downloadFiles(options, prefixLength, themeSlugs, themeList);

    return 0;
}

const exitCode: number = await main(Deno.args);
Deno.exit(exitCode);
