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
    saveDownloadStatus
} from "./lib/downloads.ts";
import { printSplitSummary, splitFilename } from "./lib/split-filename.ts";
import { PluginInfo } from "./lib/plugins.ts";
import { parseArgs, ParseOptions } from "jsr:@std/cli/parse-args";
import * as path from "jsr:@std/path";
import { ConsoleReporter, VERBOSE_CONSOLE_REPORTER, QUIET_CONSOLE_REPORTER } from "./lib/reporter.ts";

/** how the script describes itself. */
const PROGRAM_NAME: string = 'pluperfect';
/** current semver */
const VERSION: string = '0.1.0';

// set to true for quick debugging using a fixed set (much less that 100k)
const DEBUG_USE_FIXED_PLUGIN_SLUGS = false;

/** Poor implementation of an Either for the download results. */
type PluginDownloadResult = DownloadErrorInfo & PluginInfo;

/**
 * How to report non-errors.
 */
let reporter: ConsoleReporter = VERBOSE_CONSOLE_REPORTER;

/**
 * Results of parsing the command-line.
 */
interface CommandOptions {
    /** true if all files should be downloaded. */
    full: boolean;

    /** where to get information */
    apiHost: string;

    /** where to get plugins */
    downloadsHost: string;

    /** true if this is the initial import of forked sources (no skips). */
    initial: boolean;

    /** top-level directory where plugins are to be stored. */
    pluginsDir: string;

    /** how many characters to put in the directory prefix (as a string). */
    prefixLength: string;

    /** if true, only report errors. */
    quiet: boolean;

    /** where to get sources */
    repoHost: string;

    /** name of JSON file containing the download status. */
    statusFilename: string;

    /** flag indicating an update operation. */
    update: boolean;

    /** rest of the arguments of the command-line. */
    _: Array<string>;
}

/**
 * Describe the command-line options, including default
 * values.
 */
const parseOptions: ParseOptions = {
    default: {
        apiHost: 'api.wordpress.org',
        downloadsHost: 'downloads.wordpress.org',
        initial: false,
        full: false,
        pluginsDir: path.join('plugins', 'legacy'),
        prefixLength: '2',
        quiet: false,
        repoHost: 'plugins.svn.wordpress.org',
        statusFilename: 'plugins-status.json',
        update: false,
    },
    boolean: [
        'full',
        'initial',
        'quiet',
        'update',
    ],
    string: [
        'apiHost',
        'downloadsHost',
        'pluginsDir',
        'prefixLength',
        'repoHost',
        'statusFilename',
    ],
    unknown: (arg: string): unknown => {
        console.error(`Warning: unrecognized option ignored '${arg}'`);
        return false;
    }
}

/**
 * Extract a list of plugins from an HTML page.
 * @param listUrl where to access the plugin list
 * @returns list of plugin slugs.
 */
async function getPluginSlugs(listUrl: string): Promise<Array<string>> {
    if (DEBUG_USE_FIXED_PLUGIN_SLUGS) {
        return [
            'hello-dolly',              // classic, no screenshot and both banners
            'oxyplug-image',            // missing - 404
            'oxyplug-proscons',         // multiple screenshots and one banner
            decodeURIComponent('%e5%a4%9a%e8%af%b4%e7%a4%be%e4%bc%9a%e5%8c%96%e8%af%84%e8%ae%ba%e6%a1%86')  // unicode - missing - 多说社会化评论框
        ];
    }
    const rawList = await getHrefListFromPage(reporter, listUrl);
    const pluginNames =
        rawList
            .filter(n => (n !== '..') && (n !== '../'))
            .map(n => decodeURIComponent(n.slice(0, -1)));
    return pluginNames;
}

/**
 * Download a zip file, if required.
 * @param sourceUrl where to download the zip file.
 * @param pluginDir where to put the zip file.
 * @returns true if download was successful, false if not.
 */
async function downloadPluginZip(sourceUrl: string, pluginDir: string): Promise<DownloadFileInfo> {
    const zipFilename = path.join(pluginDir, sourceUrl.substring(sourceUrl.lastIndexOf('/')+1));
    return await downloadFile(reporter, new URL(sourceUrl), zipFilename);
}

/**
 * Download the plugin information JSON file, if necessary. The download
 * may be forced by setting the force parameter. If the file does not
 * exist, we will attempt to download the file.
 * @param pluginDir where to put the json file.
 * @param infoUrl where to get the json file.
 * @param force if true, remove any old file first.
 * @returns
 */
async function handlePluginInfo(pluginDir: string, infoUrl: URL, force: boolean = false): Promise<PluginDownloadResult> {
    const pluginJson = path.join(pluginDir, 'plugin.json');
    try {
        if (force) {
            await Deno.remove(pluginJson, { recursive: true });
        }
        const contents = await Deno.readTextFile(pluginJson);
        return JSON.parse(contents);
    } catch (_) {
        reporter(`fetch(${infoUrl}) > ${pluginJson}`);
        const response = await fetch(infoUrl);
        if (!response.ok) {
            const error = `${response.status} ${response.statusText}`;
            reporter(`fetch failed: ${error}`);
            return { error };
        }
        const json = await response.json();
        const text = JSON.stringify(json, null, '    ');
        await Deno.writeTextFile(pluginJson, text);
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
async function processPlugin(options: CommandOptions, prefixLength: number, slug: string, force: boolean): Promise<GroupDownloadInfo> {
    const pluginDir = path.join(options.pluginsDir, splitFilename(slug, prefixLength));

    const files: Record<string, DownloadFileInfo> = {};
    const infoUrl = getPluginInfoUrl(options.apiHost, slug);
    let ok = true;
    try {
        reporter(`> mkdir -p ${pluginDir}`);
        await Deno.mkdir(pluginDir, { recursive: true });

        const pluginInfo = await handlePluginInfo(pluginDir, infoUrl, force);
        if (pluginInfo) {
            if ((typeof pluginInfo.slug !== 'string') ||
                (typeof pluginInfo.error === 'string') ||
                (typeof pluginInfo.download_link !== 'string')) {
                ok = false;
            } else {
                const fileInfo = await downloadPluginZip(pluginInfo.download_link, pluginDir);
                ok = ok && (fileInfo.status === 'full');
                files[fileInfo.filename] = fileInfo;
                if (options.full) {
                    if (typeof pluginInfo.versions === 'object') {
                        for (const version of Object.keys(pluginInfo.versions)) {
                            if (version !== 'trunk') {
                                const fileInfo = await downloadPluginZip(pluginInfo.versions[version], pluginDir);
                                files[fileInfo.filename] = fileInfo;
                                ok = ok && (fileInfo.status === 'full');
                            }
                        }
                    }
                    if ((typeof pluginInfo.screenshots === 'object') && !Array.isArray(pluginInfo.screenshots)) {
                        const screenshotsDir = path.join(pluginDir, 'screenshots');
                        reporter(`> mkdir -p ${screenshotsDir}`);
                        await Deno.mkdir(screenshotsDir, { recursive: true });
                        for (const id of Object.keys(pluginInfo.screenshots)) {
                            if (typeof pluginInfo.screenshots[id]?.src === 'string') {
                                const src = new URL(pluginInfo.screenshots[id]?.src);
                                const filename = src.pathname.substring(src.pathname.lastIndexOf('/')+1);
                                const screenshot = path.join(screenshotsDir, filename);
                                const fileInfo = await downloadFile(reporter, src, screenshot, force);
                                files[fileInfo.filename] = fileInfo;
                                ok = ok && (fileInfo.status === 'full');
                            }
                        }
                    }
                    if ((typeof pluginInfo.banners === 'object') && !Array.isArray(pluginInfo.banners)) {
                        const bannersDir = path.join(pluginDir, 'banners');
                        reporter(`> mkdir -p ${bannersDir}`);
                        await Deno.mkdir(bannersDir, { recursive: true });
                        if (typeof pluginInfo.banners?.high === 'string') {
                            const src = new URL(pluginInfo.banners.high);
                            const filename = src.pathname.substring(src.pathname.lastIndexOf('/')+1);
                            const screenshot = path.join(bannersDir, filename);
                            const fileInfo = await downloadFile(reporter, src, screenshot, force);
                            files[fileInfo.filename] = fileInfo;
                            ok = ok && (fileInfo.status === 'full');
                    }
                        if (typeof pluginInfo.banners?.low === 'string') {
                            const src = new URL(pluginInfo.banners.low);
                            const filename = src.pathname.substring(src.pathname.lastIndexOf('/')+1);
                            const screenshot = path.join(bannersDir, filename);
                            const fileInfo = await downloadFile(reporter, src, screenshot, force);
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
        files
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
 * @param argv arguments passed after the `deno run -N pluperfect.ts`
 * @returns 0 if ok, 1 on error, 2 on usage errors.
 */
async function main(argv: Array<string>): Promise<number> {
    const options: CommandOptions = parseArgs(argv, parseOptions);

    if (options.quiet) {
        reporter = QUIET_CONSOLE_REPORTER;
    }
    reporter(`${PROGRAM_NAME} v${VERSION}`);
    const writeAccess = await Deno.permissions.request({ name: 'write', path: options.pluginsDir});
    if (writeAccess.state !== 'granted') {
        console.error(`Error: write access is required to pluginsDir ${options.pluginsDir}`);
        return 1;
    }
    const buildAccess = await Deno.permissions.request({ name: 'read', path: options.pluginsDir});
    if (buildAccess.state !== 'granted') {
        console.error(`Error: read access is required to pluginsDir ${options.pluginsDir}`);
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
    const pluginNames = await getPluginSlugs(`https://${options.repoHost}/`);
    if (pluginNames.length === 0) {
        console.error(`Error: no plugins found`);
        return 1;
    }
    reporter(`plugins found:     ${pluginNames.length}`);
    //reporter({pluginNames});
    const prefixLength = parseInt(options.prefixLength);
    if (isNaN(prefixLength)) {
        console.error(`Error: prefixLength=${options.prefixLength} is not a valid integer`);
        return 2;
    }
    if (prefixLength < 0) {
        printSplitSummary(pluginNames, 1);
        printSplitSummary(pluginNames, 2);
        printSplitSummary(pluginNames, 3);
        printSplitSummary(pluginNames, 4);
        return 0;
    }
    const statusFilename = path.join(options.pluginsDir, options.statusFilename);
    const status = await readDownloadStatus(statusFilename, pluginNames);
    let ok: boolean = true;
    let soFar: number = 0;
    let success: number = 0;
    let failure: number = 0;
    let skipped: number = 0;
    let needed: boolean = false;
    for (const slug of pluginNames) {
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
                    needed = options.update;
                    break;
                default:
                    console.error(`Error: unrecognized status. slug=${slug}, status=${status.map[slug]?.status}`);
                    break;
            }
            soFar += 1;
            if (needed || options.initial) {
                const pluginStatus = await processPlugin(options, prefixLength, slug, options.initial || options.update);
                if ((pluginStatus.status === 'full') || (pluginStatus.status === 'partial')) {
                    success += 1;
                } else if (pluginStatus.status === 'failed') {
                    failure += 1;
                } else {
                    console.error(`Warning: unknown status after processPlugin: slug=${slug}`);
                }
                status.map[slug] = pluginStatus;
                ok = ok && (pluginStatus.status !== 'failed');
            } else {
                skipped += 1;
            }
        } else {
            console.error(`Error: unknown status: slug=${slug}`);
        }
        if ((soFar % 10) == 0) {
            reporter(`save status > ${statusFilename}`);
            ok = await saveDownloadStatus(statusFilename, status) && ok;
            reporter('');
            reporter(`plugins processed:  ${soFar}`);
            reporter(`successful:         ${success}`);
            reporter(`failures:           ${failure}`);
            reporter(`skipped:            ${skipped}`);
            reporter(`ok:                 ${ok}`);
        }
    }
    status.when = Date.now();
    reporter(`save status > ${statusFilename}`);
    ok = await saveDownloadStatus(statusFilename, status) && ok;

    reporter(`Total plugins processed:  ${soFar}`);
    reporter(`Total successful:         ${success}`);
    reporter(`Total failures:           ${failure}`);
    reporter(`Total skipped:            ${skipped}`);
    reporter(`ok:                       ${ok}`);

    if (!ok) {
        return 1;
    }
    return 0;
}

const exitCode: number = await main(Deno.args);
Deno.exit(exitCode);

