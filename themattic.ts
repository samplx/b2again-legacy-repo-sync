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

/** how the script describes itself. */
const PROGRAM_NAME: string = 'themattic';
/** current semver */
const VERSION: string = '0.1.1';

/**
 * A simple Either-like structure to capture the results of a download.
 */
type ThemeDownloadResult = DownloadErrorInfo & ThemeInfo;

/**
 * How to report non-errors.
 */
let reporter: ConsoleReporter = VERBOSE_CONSOLE_REPORTER;

/**
 * Results of parsing the command-line.
 */
interface CommandOptions {
    /** where to get information */
    apiHost: string;

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

    /** spaces when rendering JSON. */
    jsonSpaces: string;

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

    /** top-level directory where build results are to be stored. */
    themesDir: string;

    /** flag indicating an update operation. */
    update: boolean;

    /** flag indicating a request to print the version. */
    version: boolean;

    DEBUG_USE_FIXED_THEME_SLUGS: boolean;

    /** rest of the arguments of the command-line. */
    _: Array<string>;
}


const parseOptions: ParseOptions = {
    default: {
        apiHost: 'api.wordpress.org',
        downloadsBaseUrl: 'https://downloads.b2again.org/',
        downloadsHost: 'downloads.wordpress.org',
        force: false,
        full: false,
        help: false,
        jsonSpaces: '    ',
        prefixLength: '2',
        quiet: false,
        repoHost: 'themes.svn.wordpress.org',
        retry: false,
        statusFilename: 'themes-status.json',
        supportBaseUrl: 'https://support.b2again.org/',
        themesDir: 'themes',
        update: false,
        version: false,
        DEBUG_USE_FIXED_THEME_SLUGS: false,
    },
    boolean: [
        'force',
        'full',
        'help',
        'quiet',
        'retry',
        'update',
        'version',
        'DEBUG_USE_FIXED_THEME_SLUGS'
    ],
    string: [
        'apiHost',
        'downloadsHost',
        'jsonSpaces',
        'prefixLength',
        'repoHost',
        'statusFilename',
        'downloadsBaseUrl',
        'supportBaseUrl',
        'themesDir'
    ],
    unknown: (arg: string): unknown => {
        console.error(`Warning: unrecognized option ignored '${arg}'`);
        return false;
    }
}
/**
 *
 * @param options command-line options.
 * @param prefixLength number of characters to use in the directory prefix.
 * @param slug theme slug.
 * @returns
 */
async function processTheme(options: CommandOptions, prefixLength: number, slug: string): Promise<GroupDownloadInfo> {
    const themeReadOnlyDir = path.join(options.themesDir, 'read-only', 'legacy', splitFilename(slug, prefixLength));
    const themeMetaDir = path.join(options.themesDir, 'meta', 'legacy', splitFilename(slug, prefixLength));
    const themeLiveDir = path.join(options.themesDir, 'live', 'legacy', splitFilename(slug, prefixLength));

    const files: Record<string, DownloadFileInfo> = {};
    const infoUrl = getThemeInfoUrl(options.apiHost, slug);
    let ok = true;
    try {
        reporter(`> mkdir -p ${themeReadOnlyDir}`);
        await Deno.mkdir(themeReadOnlyDir, { recursive: true });
        reporter(`> mkdir -p ${themeMetaDir}`);
        await Deno.mkdir(themeMetaDir, { recursive: true });

        const themeInfo = await handleThemeInfo(options, themeLiveDir, themeMetaDir, themeReadOnlyDir, infoUrl);
        if (themeInfo) {
            if ((typeof themeInfo.slug !== 'string') ||
                (typeof themeInfo.error === 'string') ||
                (typeof themeInfo.download_link !== 'string')) {
                ok = false;
            } else {
                const zipFilename = path.join(themeReadOnlyDir, themeInfo.download_link.substring(themeInfo.download_link.lastIndexOf('/')+1));
                const fileInfo = await downloadFile(reporter, new URL(themeInfo.download_link), zipFilename, options.force, options.update);
                ok = ok && (fileInfo.status === 'full');
                files[fileInfo.filename] = fileInfo;
                if (options.full) {
                    if (typeof themeInfo.preview_url === 'string') {
                        // preview_url
                        const previewDir = path.join(themeLiveDir, 'preview');
                        reporter(`> mkdir -p ${previewDir}`);
                        await Deno.mkdir(previewDir, { recursive: true });
                        const previewIndex = path.join(previewDir, 'index.html');
                        const previewInfo = await downloadFile(reporter, new URL(themeInfo.preview_url), previewIndex, options.force, options.update);
                        ok = ok && (previewInfo.status === 'full');
                        files[previewInfo.filename] = previewInfo;
                    }
                    if (typeof themeInfo.screenshot_url === 'string') {
                        // screenshot_url
                        const screenshotsDir = path.join(themeLiveDir, 'screenshots');
                        reporter(`> mkdir -p ${screenshotsDir}`);
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
        files
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
    infoUrl: URL
): Promise<ThemeDownloadResult> {
    const themeJson = path.join(themeMetaDir, 'theme.json');
    const legacyThemeJson = path.join(themeMetaDir, 'legacy-theme.json');
    try {
        if (options.force) {
            await Deno.remove(themeJson, { recursive: true });
            await Deno.remove(legacyThemeJson, { recursive: true });
        }
        const contents = await Deno.readTextFile(legacyThemeJson);
        return JSON.parse(contents);
    } catch (_) {
        reporter(`fetch(${infoUrl}) > ${themeJson}`);
        const response = await fetch(infoUrl);
        if (!response.ok) {
            const error = `${response.status} ${response.statusText}`;
            reporter(`fetch failed: ${error}`);
            return { error };
        }
        const json = await response.json();
        const rawText = JSON.stringify(json, null, options.jsonSpaces);
        const migrated = migrateThemeInfo(options.downloadsBaseUrl, options.supportBaseUrl, themeLiveDir, themeReadOnlyDir, json);
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
async function downloadFiles(options: CommandOptions, prefixLength: number, themeSlugs: Array<string>): Promise<void> {
    const statusFilename = path.join(options.themesDir, options.statusFilename);
    const status = await readDownloadStatus(statusFilename, themeSlugs);
    let ok: boolean = true;
    let soFar: number = 0;
    let success: number = 0;
    let failure: number = 0;
    let skipped: number = 0;
    let needed: boolean = false;
    let changed: boolean = false;
    for (const slug of themeSlugs) {
        needed = false;
        if (typeof status.map[slug] !== 'object') {
            status.map[slug] = { status: 'unknown', when: 0, files: {} };
        }
        if ((typeof status.map[slug] === 'object') &&
            (typeof status.map[slug]?.status === 'string') &&
            (typeof status.map[slug]?.when === 'number')) {
            switch (status.map[slug]?.status) {
                case 'unknown':
                    needed = true;
                    break;
                case 'partial':
                    needed = options.full;
                    break;
                case 'full':
                    needed = false;
                    break;
                case 'failed':
                    needed = options.retry;
                    break;
                default:
                    console.error(`Error: unrecognized status. slug=${slug}, status=${status.map[slug]?.status}`);
                    break;
            }
            soFar += 1;
            if (needed || options.force) {
                const themeStatus = await processTheme(options, prefixLength, slug);
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
        if ((soFar % 10) == 0) {
            if (changed) {
                reporter(`save status > ${statusFilename}`);
                ok = await saveDownloadStatus(statusFilename, status) && ok;
            }
            changed = false;
            reporter('');
            reporter(`themes processed:   ${soFar}`);
            reporter(`successful:         ${success}`);
            reporter(`failures:           ${failure}`);
            reporter(`skipped:            ${skipped}`);
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
 * Provide help to the user.
 */
function printHelp(): void {
    console.log(`${PROGRAM_NAME} [options]`);
    console.log();
    console.log(`Options include [default value]:`);
    console.log(`--apiHost=host             [${parseOptions.default?.apiHost}]`);
    console.log(`    define where to load theme data.`);
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
    console.log(`--jsonSpaces=spaces        [${parseOptions.default?.jsonSpaces}]`);
    console.log(`    spaces used to delimit generated JSON files.`);
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
    console.log(`--themesDir=dir            [${parseOptions.default?.themesDir}]`);
    console.log(`    define where save files (must end with "themes").`);
    console.log(`--update                   [${parseOptions.default?.update}]`);
    console.log(`    recalculate message digests (hashes).`);
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
    reporter(`${PROGRAM_NAME} v${VERSION}`);
    const writeAccess = await Deno.permissions.request({ name: 'write', path: options.themesDir});
    if (writeAccess.state !== 'granted') {
        console.error(`Error: write access is required to themesDir ${options.themesDir}`);
        return 1;
    }
    const buildAccess = await Deno.permissions.request({ name: 'read', path: options.themesDir});
    if (buildAccess.state !== 'granted') {
        console.error(`Error: read access is required to themesDir ${options.themesDir}`);
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
    const themeSlugs = await getThemeSlugs(`https://${options.repoHost}/`, options.DEBUG_USE_FIXED_THEME_SLUGS);
    if (themeSlugs.length === 0) {
        console.error(`Error: no themes found`);
        return 1;
    }
    reporter(`themes found:      ${themeSlugs.length}`);
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

    await downloadFiles(options, prefixLength, themeSlugs);

    return 0;
}

const exitCode: number = await main(Deno.args);
Deno.exit(exitCode);
