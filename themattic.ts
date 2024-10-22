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
    GroupDownloadInfo,
    readDownloadStatus,
    saveDownloadStatus,
    mergeDownloadInfo,
    downloadZip
} from "./lib/downloads.ts";
import { CommandOptions, DEFAULT_PACE, isValidListType, printHelp } from "./lib/options.ts";
import { printSplitSummary, splitFilename } from "./lib/split-filename.ts";
import { parseArgs, ParseOptions } from "jsr:@std/cli/parse-args";
import * as path from "jsr:@std/path";
import { migrateThemeInfo, ThemeInfo } from "./lib/themes.ts";
import { ConsoleReporter, VERBOSE_CONSOLE_REPORTER, QUIET_CONSOLE_REPORTER } from "./lib/reporter.ts";
import { getParseOptions } from "./lib/options.ts";
import { getItemList, getItemLists, itemListsReport, saveItemLists } from "./lib/item-lists.ts";

/** how the script describes itself. */
const PROGRAM_NAME: string = 'themattic';
/** current semver */
const VERSION: string = '0.2.1';

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

/**
 * describes the command-line options.
 */
const parseOptions: ParseOptions = getParseOptions('theme');

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
    const split = splitFilename(slug, prefixLength);
    const themeReadOnlyDir = path.join(options.documentRoot, 'themes', 'read-only', 'legacy', split);
    const themeMetaDir = path.join(options.documentRoot, 'themes', 'meta', 'legacy', split);
    const themeLiveDir = path.join(options.documentRoot, 'themes', 'live', 'legacy', split);

    const files: Record<string, DownloadFileInfo> = {};
    const infoUrl = getThemeInfoUrl(options.apiHost, slug);
    let ok = true;
    let last_updated_time;
    try {
        vreporter(`> mkdir -p ${themeReadOnlyDir}`);
        await Deno.mkdir(themeReadOnlyDir, { recursive: true });
        vreporter(`> mkdir -p ${themeMetaDir}`);
        await Deno.mkdir(themeMetaDir, { recursive: true });

        const themeInfo = await handleThemeInfo(options, themeMetaDir, infoUrl, split, outdated || options.force, fromAPI);
        if (themeInfo) {
            if ((typeof themeInfo.slug !== 'string') ||
                (typeof themeInfo.error === 'string') ||
                (typeof themeInfo.download_link !== 'string')) {
                ok = false;
            } else {
                last_updated_time = themeInfo.last_updated_time;
                const fileInfo = await downloadZip(reporter, options, themeInfo.download_link, themeReadOnlyDir);
                ok = ok && (fileInfo.status === 'full');
                files[fileInfo.filename] = fileInfo;
                if (options.full) {
                    if (typeof themeInfo.preview_url === 'string') {
                        // preview_url
                        const previewDir = path.join(themeLiveDir, 'preview');
                        vreporter(`> mkdir -p ${previewDir}`);
                        await Deno.mkdir(previewDir, { recursive: true });
                        const previewIndex = path.join(previewDir, 'index.html');
                        const previewInfo = await downloadFile(reporter, new URL(themeInfo.preview_url), previewIndex, options.force, options.rehash);
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
                        const screenshotInfo = await downloadFile(reporter, screenshotUrl, screenshotFile, options.force, options.rehash);
                        ok = ok && (screenshotInfo.status === 'full');
                        files[screenshotInfo.filename] = screenshotInfo;
                    }
                    if (typeof themeInfo.versions === 'object') {
                        for (const version in themeInfo.versions) {
                            if (version !== 'trunk') {
                                const fileInfo = await downloadZip(reporter, options, themeInfo.versions[version], themeReadOnlyDir);
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
    themeMetaDir: string,
    infoUrl: URL,
    split: string,
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
        const migrated = migrateThemeInfo(options.downloadsBaseUrl, options.supportBaseUrl, split, json, fromAPI);
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
            if (needed || options.force || options.rehash || outdated) {
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
        printHelp(PROGRAM_NAME, parseOptions);
        return 0;
    }
    if (options.quiet) {
        reporter = QUIET_CONSOLE_REPORTER;
    }
    if (options.verbose) {
        vreporter = VERBOSE_CONSOLE_REPORTER;
    }
    reporter(`${PROGRAM_NAME} v${VERSION}`);
    reporter(`started:   ${new Date().toUTCString()}`);

    // check for permissions
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
        const themeLists = await getItemLists(reporter, options, 'theme');
        itemListsReport(reporter, themeLists);
        await saveItemLists(reporter, options, 'theme', themeLists);
        return 0;
    }

    if (!isValidListType(options.list)) {
        console.error(`Error: unrecognized list type: ${options.list}`);
        return 1;
    }
    const themeList = await getItemList(reporter, options, 'theme', options.list);
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

    await downloadFiles(options, prefixLength, themeSlugs, themeList as Array<ThemeInfo>);
    reporter(`completed: ${new Date().toUTCString()}`);

    return 0;
}

const exitCode: number = await main(Deno.args);
Deno.exit(exitCode);
