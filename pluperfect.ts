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
    downloadZip,
    GroupDownloadInfo,
    mergeDownloadInfo,
    readDownloadStatus,
    saveDownloadStatus
} from "./lib/downloads.ts";
import { printSplitSummary, splitFilename } from "./lib/split-filename.ts";
import { migratePluginInfo, PluginInfo } from "./lib/plugins.ts";
import { parseArgs, ParseOptions } from "jsr:@std/cli/parse-args";
import * as path from "jsr:@std/path";
import { ConsoleReporter, VERBOSE_CONSOLE_REPORTER, QUIET_CONSOLE_REPORTER } from "./lib/reporter.ts";
import { DEFAULT_PACE, getParseOptions, isValidListType, printHelp, type CommandOptions } from "./lib/options.ts";
import { getItemList, getItemLists, itemListsReport, saveItemLists } from "./lib/item-lists.ts";

/** how the script describes itself. */
const PROGRAM_NAME: string = 'pluperfect';
/** current semver */
const VERSION: string = '0.2.1';

/** Poor implementation of an Either for the download results. */
type PluginDownloadResult = DownloadErrorInfo & PluginInfo;

/**
 * How to report non-errors.
 */
let reporter: ConsoleReporter = VERBOSE_CONSOLE_REPORTER;

/**
 * How to report verbose messages.
 */
let vreporter: ConsoleReporter = QUIET_CONSOLE_REPORTER;

/**
 * Describe the command-line options, including default
 * values.
 */
const parseOptions: ParseOptions = getParseOptions('plugin');

/**
 * Download the plugin information JSON file, if necessary. The download
 * may be forced by setting the force parameter. If the file does not
 * exist, we will attempt to download the file.
 * @param pluginDir where to put the json file.
 * @param infoUrl where to get the json file.
 * @param force if true, remove any old file first.
 * @returns
 */
async function handlePluginInfo(
    options: CommandOptions,
    pluginMetaDir: string,
    infoUrl: URL,
    split: string,
    force: boolean,
    fromAPI: PluginInfo
): Promise<PluginDownloadResult> {
    const pluginJson = path.join(pluginMetaDir, 'plugin.json');
    const legacyPluginJson = path.join(pluginMetaDir, 'legacy-plugin.json');

    try {
        if (force) {
            await Deno.remove(pluginJson, { recursive: true });
            await Deno.remove(legacyPluginJson, { recursive: true });
        }
        const contents = await Deno.readTextFile(legacyPluginJson);
        return JSON.parse(contents);
    } catch (_) {
        reporter(`fetch(${infoUrl}) > ${legacyPluginJson}`);
        const response = await fetch(infoUrl);
        if (!response.ok) {
            const error = `${response.status} ${response.statusText}`;
            reporter(`fetch failed: ${error}`);
            return { error };
        }
        const json = await response.json();
        const rawText = JSON.stringify(json, null, options.jsonSpaces);
        const migrated = migratePluginInfo(options.downloadsBaseUrl,
                options.supportBaseUrl, split, json, fromAPI);
        const text = JSON.stringify(migrated, null, options.jsonSpaces);
        await Deno.writeTextFile(pluginJson, text);
        await Deno.writeTextFile(legacyPluginJson, rawText);
        return json;
    }
}

/**
 *
 * @param options command-line options.
 * @param prefixLength number of characters to use in the directory prefix.
 * @param slug plugin slug.
 * @returns
 */
async function processPlugin(
    options: CommandOptions,
    prefixLength: number,
    slug: string,
    outdated: boolean,
    fromAPI: PluginInfo
): Promise<GroupDownloadInfo> {
    const split = splitFilename(slug, prefixLength);
    const pluginLiveDir = path.join(options.documentRoot, 'plugins', 'live', 'legacy', split);
    const pluginMetaDir = path.join(options.documentRoot, 'plugins', 'meta', 'legacy', split);
    const pluginReadOnlyDir = path.join(options.documentRoot, 'plugins', 'read-only', 'legacy', split);

    const files: Record<string, DownloadFileInfo> = {};
    const infoUrl = getPluginInfoUrl(options.apiHost, slug);
    let ok = true;
    let last_updated_time;
    try {
        vreporter(`> mkdir -p ${pluginReadOnlyDir}`);
        await Deno.mkdir(pluginReadOnlyDir, { recursive: true });
        vreporter(`> mkdir -p ${pluginMetaDir}`);
        await Deno.mkdir(pluginMetaDir, { recursive: true });

        const pluginInfo = await handlePluginInfo(options, pluginMetaDir,
                infoUrl, split, (outdated || options.force), fromAPI);
        if (pluginInfo) {
            if ((typeof pluginInfo.slug !== 'string') ||
                (typeof pluginInfo.error === 'string') ||
                (typeof pluginInfo.download_link !== 'string')) {
                ok = false;
            } else {
                last_updated_time = pluginInfo.last_updated;
                const fileInfo = await downloadZip(reporter, options, pluginInfo.download_link, pluginReadOnlyDir);
                ok = ok && (fileInfo.status === 'full');
                files[fileInfo.filename] = fileInfo;
                if (options.full) {
                    if (typeof pluginInfo.versions === 'object') {
                        for (const version of Object.keys(pluginInfo.versions)) {
                            if ((version !== 'trunk') && pluginInfo.versions[version]) {
                                const fileInfo = await downloadZip(reporter, options, pluginInfo.versions[version], pluginReadOnlyDir);
                                files[fileInfo.filename] = fileInfo;
                                ok = ok && (fileInfo.status === 'full');
                            }
                        }
                    }
                    if ((typeof pluginInfo.screenshots === 'object') && !Array.isArray(pluginInfo.screenshots)) {
                        const screenshotsDir = path.join(pluginLiveDir, 'screenshots');
                        vreporter(`> mkdir -p ${screenshotsDir}`);
                        await Deno.mkdir(screenshotsDir, { recursive: true });
                        for (const id of Object.keys(pluginInfo.screenshots)) {
                            if (typeof pluginInfo.screenshots[id]?.src === 'string') {
                                const src = new URL(pluginInfo.screenshots[id]?.src);
                                const filename = src.pathname.substring(src.pathname.lastIndexOf('/')+1);
                                const screenshot = path.join(screenshotsDir, filename);
                                const fileInfo = await downloadFile(reporter, src, screenshot, options.force, options.rehash);
                                files[fileInfo.filename] = fileInfo;
                                ok = ok && (fileInfo.status === 'full');
                            }
                        }
                    }
                    if ((typeof pluginInfo.banners === 'object') && !Array.isArray(pluginInfo.banners)) {
                        const bannersDir = path.join(pluginLiveDir, 'banners');
                        vreporter(`> mkdir -p ${bannersDir}`);
                        await Deno.mkdir(bannersDir, { recursive: true });
                        if (typeof pluginInfo.banners?.high === 'string') {
                            const src = new URL(pluginInfo.banners.high);
                            const filename = src.pathname.substring(src.pathname.lastIndexOf('/')+1);
                            const screenshot = path.join(bannersDir, filename);
                            const fileInfo = await downloadFile(reporter, src, screenshot, options.force, options.rehash);
                            files[fileInfo.filename] = fileInfo;
                            ok = ok && (fileInfo.status === 'full');
                        }
                        if (typeof pluginInfo.banners?.low === 'string') {
                            const src = new URL(pluginInfo.banners.low);
                            const filename = src.pathname.substring(src.pathname.lastIndexOf('/')+1);
                            const screenshot = path.join(bannersDir, filename);
                            const fileInfo = await downloadFile(reporter, src, screenshot, options.force, options.rehash);
                            files[fileInfo.filename] = fileInfo;
                            ok = ok && (fileInfo.status === 'full');
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
 * Determine the URL to use to request plugin information.
 * @param apiHost where the API is.
 * @param name slug used to access the plugin.
 * @returns
 */
function getPluginInfoUrl(apiHost: string, name: string): URL {
    const url = new URL('/plugins/info/1.2/', `https://${apiHost}`);
    url.searchParams.append('action', 'plugin_information');
    url.searchParams.append('slug', name);
    return url;
}

/**
 *
 * @param options command-line options.
 * @param prefixLength number of characters in prefix of split filename.
 * @param pluginSlugs list of plugin slugs.
 */
async function downloadFiles(
    options: CommandOptions,
    prefixLength: number,
    pluginSlugs: Array<string>,
    pluginList: Array<PluginInfo>): Promise<void> {

    const statusFilename = path.join(options.documentRoot, 'plugins', 'meta', options.statusFilename);
    const status = await readDownloadStatus(statusFilename, pluginSlugs);
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
        if (!pluginSlugs.includes(slug)) {
            status.map[slug].status = 'uninteresting';
        }
    }

    for (const item of pluginList) {
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
                (typeof item?.last_updated === 'string') &&
                (status.map[slug].last_updated_time < item.last_updated)) {
                status.map[slug].status = 'outdated';
            }
            // determine if we need this plugin
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
                const pluginStatus = await processPlugin(options, prefixLength, slug, outdated, item);
                if ((pluginStatus.status === 'full') || (pluginStatus.status === 'partial')) {
                    success += 1;
                } else if (pluginStatus.status === 'failed') {
                    failure += 1;
                } else {
                    console.error(`Warning: unknown status after processPlugin: slug=${slug}`);
                }
                changed = true;
                status.map[slug] = pluginStatus;
                const existing = status.map[slug].files;
                status.map[slug].status = pluginStatus.status;
                status.map[slug].when = pluginStatus.when;
                status.map[slug].last_updated_time = pluginStatus.last_updated_time;
                status.map[slug].files = {};
                for (const name in pluginStatus.files) {
                    status.map[slug].files[name] = mergeDownloadInfo(existing[name], pluginStatus.files[name]);
                }

                ok = ok && (pluginStatus.status !== 'failed');
            } else {
                skipped += 1;
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
            reporter('');
            reporter(`plugins processed:  ${soFar}`);
            reporter(`successful:         ${success}`);
            reporter(`failures:           ${failure}`);
            reporter(`skipped:            ${skipped}`);
        }
    }
    status.when = Date.now();
    reporter(`save status > ${statusFilename}`);
    ok = await saveDownloadStatus(statusFilename, status) && ok;

    reporter(`Total plugins processed:  ${soFar}`);
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

    // check for permissions
    const writeAccess = await Deno.permissions.request({ name: 'write', path: options.documentRoot});
    if (writeAccess.state !== 'granted') {
        console.error(`Error: write access is required to pluginsDir ${options.documentRoot}`);
        return 1;
    }
    const buildAccess = await Deno.permissions.request({ name: 'read', path: options.documentRoot});
    if (buildAccess.state !== 'granted') {
        console.error(`Error: read access is required to pluginsDir ${options.documentRoot}`);
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
        const pluginLists = await getItemLists(reporter, options, 'plugin');
        itemListsReport(reporter, pluginLists);
        await saveItemLists(reporter, options, 'plugin', pluginLists);
        return 0;
    }

    if (!isValidListType(options.list)) {
        console.error(`Error: unrecognized list type: ${options.list}`);
        return 1;
    }
    const pluginList = await getItemList(reporter, options, 'plugin', options.list);
    const pluginSlugs: Array<string> = [];
    pluginList.forEach((item) => { if (item.slug) { pluginSlugs.push(item.slug) } });
    reporter(`plugins found:      ${pluginList.length}`);

    const prefixLength = parseInt(options.prefixLength);
    if (isNaN(prefixLength)) {
        console.error(`Error: prefixLength=${options.prefixLength} is not a valid integer`);
        return 2;
    }
    if (prefixLength < 0) {
        printSplitSummary(pluginSlugs, 1);
        printSplitSummary(pluginSlugs, 2);
        printSplitSummary(pluginSlugs, 3);
        printSplitSummary(pluginSlugs, 4);
        return 0;
    }

    await downloadFiles(options, prefixLength, pluginSlugs, pluginList as Array<PluginInfo>);

    return 0;
}

const exitCode: number = await main(Deno.args);
Deno.exit(exitCode);

