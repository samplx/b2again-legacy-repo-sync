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
    mergeDownloadInfo,
    readDownloadStatus,
    saveDownloadStatus
} from "./lib/downloads.ts";
import { printSplitSummary, splitFilename } from "./lib/split-filename.ts";
import { migratePluginInfo, PluginInfo } from "./lib/plugins.ts";
import { parseArgs, ParseOptions } from "jsr:@std/cli/parse-args";
import * as path from "jsr:@std/path";
import { ConsoleReporter, VERBOSE_CONSOLE_REPORTER, QUIET_CONSOLE_REPORTER } from "./lib/reporter.ts";

/** how the script describes itself. */
const PROGRAM_NAME: string = 'pluperfect';
/** current semver */
const VERSION: string = '0.1.1';

/** default number of items processed between saves of the status file. */
const DEFAULT_PACE: number = 25;

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
    /** where to get information */
    apiHost: string;

    /** base url for static file downloads. */
    downloadsBaseUrl: string;

    /** where to get plugins */
    downloadsHost: string;

    /** true to force files to be downloaded. */
    force: boolean;

    /** true if all missing files should be downloaded. */
    full: boolean;

    /** true if user requested help. */
    help: boolean;

    /** how many spaces between elements in JSON. */
    jsonSpaces: string;

    /** number of items processed between saves of the status file (as a string). */
    pace: string;

    /** top-level directory where plugins are to be stored. */
    pluginsDir: string;

    /** how many characters to put in the directory prefix (as a string). */
    prefixLength: string;

    /** if true, only report errors. */
    quiet: boolean;

    /** where to get sources */
    repoHost: string;

    /** true if failed downloads should be retried. */
    retry: boolean;

    /** name of JSON file containing the download status. */
    statusFilename: string;

    /** base url for support pages. */
    supportBaseUrl: string;

    /** flag indicating an update operation. */
    update: boolean;

    /** flag indicating a request to print the version. */
    version: boolean;

    /** debug flag to use a fixed list of plugin slugs. */
    DEBUG_USE_FIXED_PLUGIN_SLUGS: boolean;

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
        downloadsBaseUrl: 'https://downloads.b2again.org/',
        downloadsHost: 'downloads.wordpress.org',
        force: false,
        full: false,
        help: false,
        jsonSpaces: '    ',
        pace: `${DEFAULT_PACE}`,
        pluginsDir: 'plugins',
        prefixLength: '2',
        quiet: false,
        repoHost: 'plugins.svn.wordpress.org',
        retry: false,
        statusFilename: 'plugins-status.json',
        supportBaseUrl: 'https://support.b2again.org/',
        update: false,
        version: false,
        DEBUG_USE_FIXED_PLUGIN_SLUGS: false,
    },
    boolean: [
        'force',
        'full',
        'help',
        'quiet',
        'retry',
        'update',
        'version',
        'DEBUG_USE_FIXED_PLUGIN_SLUGS'
    ],
    string: [
        'apiHost',
        'downloadsBaseUrl',
        'downloadsHost',
        'jsonSpaces',
        'pace',
        'pluginsDir',
        'prefixLength',
        'repoHost',
        'statusFilename',
        'supportBaseUrl',
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
async function getPluginSlugs(listUrl: string, useFixedList: boolean = false): Promise<Array<string>> {
    if (useFixedList) {
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
async function downloadPluginZip(options: CommandOptions, sourceUrl: string, pluginDir: string): Promise<DownloadFileInfo> {
    const zipFilename = path.join(pluginDir, sourceUrl.substring(sourceUrl.lastIndexOf('/')+1));
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
 * Download the plugin information JSON file, if necessary. The download
 * may be forced by setting the force parameter. If the file does not
 * exist, we will attempt to download the file.
 * @param pluginDir where to put the json file.
 * @param infoUrl where to get the json file.
 * @param force if true, remove any old file first.
 * @returns
 */
async function handlePluginInfo(options: CommandOptions, pluginMetaDir: string, split: string, infoUrl: URL): Promise<PluginDownloadResult> {
    const pluginJson = path.join(pluginMetaDir, 'plugin.json');
    const legacyPluginJson = path.join(pluginMetaDir, 'legacy-plugin.json');

    try {
        if (options.force) {
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
        const migrated = migratePluginInfo(options.downloadsBaseUrl, options.supportBaseUrl, split, json);
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
async function processPlugin(options: CommandOptions, prefixLength: number, slug: string): Promise<GroupDownloadInfo> {
    const split = splitFilename(slug, prefixLength);
    const pluginLiveDir = path.join(options.pluginsDir, 'live', 'legacy', split);
    const pluginMetaDir = path.join(options.pluginsDir, 'meta', 'legacy', split);
    const pluginReadOnlyDir = path.join(options.pluginsDir, 'read-only', 'legacy', split);

    const files: Record<string, DownloadFileInfo> = {};
    const infoUrl = getPluginInfoUrl(options.apiHost, slug);
    let ok = true;
    try {
        reporter(`> mkdir -p ${pluginReadOnlyDir}`);
        await Deno.mkdir(pluginReadOnlyDir, { recursive: true });
        reporter(`> mkdir -p ${pluginMetaDir}`);
        await Deno.mkdir(pluginMetaDir, { recursive: true });

        const pluginInfo = await handlePluginInfo(options, pluginMetaDir, split, infoUrl);
        if (pluginInfo) {
            if ((typeof pluginInfo.slug !== 'string') ||
                (typeof pluginInfo.error === 'string') ||
                (typeof pluginInfo.download_link !== 'string')) {
                ok = false;
            } else {
                const fileInfo = await downloadPluginZip(options, pluginInfo.download_link, pluginReadOnlyDir);
                ok = ok && (fileInfo.status === 'full');
                files[fileInfo.filename] = fileInfo;
                if (options.full) {
                    if (typeof pluginInfo.versions === 'object') {
                        for (const version of Object.keys(pluginInfo.versions)) {
                            if ((version !== 'trunk') && pluginInfo.versions[version]) {
                                const fileInfo = await downloadPluginZip(options, pluginInfo.versions[version], pluginReadOnlyDir);
                                files[fileInfo.filename] = fileInfo;
                                ok = ok && (fileInfo.status === 'full');
                            }
                        }
                    }
                    if ((typeof pluginInfo.screenshots === 'object') && !Array.isArray(pluginInfo.screenshots)) {
                        const screenshotsDir = path.join(pluginLiveDir, 'screenshots');
                        reporter(`> mkdir -p ${screenshotsDir}`);
                        await Deno.mkdir(screenshotsDir, { recursive: true });
                        for (const id of Object.keys(pluginInfo.screenshots)) {
                            if (typeof pluginInfo.screenshots[id]?.src === 'string') {
                                const src = new URL(pluginInfo.screenshots[id]?.src);
                                const filename = src.pathname.substring(src.pathname.lastIndexOf('/')+1);
                                const screenshot = path.join(screenshotsDir, filename);
                                const fileInfo = await downloadFile(reporter, src, screenshot, options.force, options.update);
                                files[fileInfo.filename] = fileInfo;
                                ok = ok && (fileInfo.status === 'full');
                            }
                        }
                    }
                    if ((typeof pluginInfo.banners === 'object') && !Array.isArray(pluginInfo.banners)) {
                        const bannersDir = path.join(pluginLiveDir, 'banners');
                        reporter(`> mkdir -p ${bannersDir}`);
                        await Deno.mkdir(bannersDir, { recursive: true });
                        if (typeof pluginInfo.banners?.high === 'string') {
                            const src = new URL(pluginInfo.banners.high);
                            const filename = src.pathname.substring(src.pathname.lastIndexOf('/')+1);
                            const screenshot = path.join(bannersDir, filename);
                            const fileInfo = await downloadFile(reporter, src, screenshot, options.force, options.update);
                            files[fileInfo.filename] = fileInfo;
                            ok = ok && (fileInfo.status === 'full');
                        }
                        if (typeof pluginInfo.banners?.low === 'string') {
                            const src = new URL(pluginInfo.banners.low);
                            const filename = src.pathname.substring(src.pathname.lastIndexOf('/')+1);
                            const screenshot = path.join(bannersDir, filename);
                            const fileInfo = await downloadFile(reporter, src, screenshot, options.force, options.update);
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
 * @param options command-line options.
 * @param prefixLength number of characters in prefix of split filename.
 * @param pluginSlugs list of plugin slugs.
 */
async function downloadFiles(options: CommandOptions, prefixLength: number, pluginSlugs: Array<string>): Promise<void> {
    const statusFilename = path.join(options.pluginsDir, options.statusFilename);
    const status = await readDownloadStatus(statusFilename, pluginSlugs);
    let ok: boolean = true;
    let soFar: number = 0;
    let success: number = 0;
    let failure: number = 0;
    let skipped: number = 0;
    let needed: boolean = false;
    let changed: boolean = false;
    let pace: number = parseInt(options.pace);
    if (isNaN(pace)) {
        pace = DEFAULT_PACE;
        console.error(`Warning: unable to parse ${options.pace} as an integer. default ${pace} is used`);
    }
    for (const slug of pluginSlugs) {
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
                const pluginStatus = await processPlugin(options, prefixLength, slug);
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
 * Provide help to the user.
 */
function printHelp(): void {
    console.log(`${PROGRAM_NAME} [options]`);
    console.log();
    console.log(`Options include [default value]:`);
    console.log(`--apiHost=host             [${parseOptions.default?.apiHost}]`);
    console.log(`    define where to load plugin data.`);
    console.log(`--downloadsBaseUrl=url     [${parseOptions.default?.downloadsBaseUrl}]`);
    console.log(`    define downstream downloads host.`);
    console.log(`--downloadsHost=host       [${parseOptions.default?.downloadsHost}]`);
    console.log(`    define where to load plugin zip files.`);
    console.log(`--force                    [${parseOptions.default?.force}]`);
    console.log(`    force download of files.`);
    console.log(`--full                     [${parseOptions.default?.full}]`);
    console.log(`    full archive. include all versions, screenshots, and banners`);
    console.log(`--help`);
    console.log(`    print this message and exit.`);
    console.log(`--jsonSpaces=spaces        [${parseOptions.default?.jsonSpaces}]`);
    console.log(`    spaces used to delimit generated JSON files.`);
    console.log(`--pace=number              [${parseOptions.default?.pace}]`);
    console.log(`    number of items processed between status file saves.`);
    console.log(`--pluginsDir=dir           [${parseOptions.default?.pluginsDir}]`);
    console.log(`    define where save files (must end with "plugins").`);
    console.log(`--prefixLength=number      [${parseOptions.default?.prefixLength}]`);
    console.log(`    number of characters in directory prefix.`);
    console.log(`--quiet                    [${parseOptions.default?.quiet}]`);
    console.log(`    be quiet. supress non-error messages.`);
    console.log(`--repoHost=host            [${parseOptions.default?.repoHost}]`);
    console.log(`    define where to load list of plugins from subversion.`);
    console.log(`--retry                    [${parseOptions.default?.retry}]`);
    console.log(`    retry to download failed files.`);
    console.log(`--statusFilename=name      [${parseOptions.default?.statusFilename}]`);
    console.log(`    define where to save status information.`);
    console.log(`--supportBaseUrl=url       [${parseOptions.default?.supportBaseUrl}]`);
    console.log(`    define downstream support host.`);
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
    const pluginNames = await getPluginSlugs(`https://${options.repoHost}/`, options.DEBUG_USE_FIXED_PLUGIN_SLUGS);
    if (pluginNames.length === 0) {
        console.error(`Error: no plugins found`);
        return 1;
    }
    reporter(`plugins found:     ${pluginNames.length}`);

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

    await downloadFiles(options, prefixLength, pluginNames);

    return 0;
}

const exitCode: number = await main(Deno.args);
Deno.exit(exitCode);

