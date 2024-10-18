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

import { crypto } from "jsr:@std/crypto/crypto";
import { ConsoleReporter } from "./reporter.ts";

export type DownloadStatus = 'unknown' | 'partial' | 'full' | 'failed';

export interface DownloadFileInfo {
    filename: string;
    status: DownloadStatus;
    when: number;
    sha256?: string;
    md5?: string;
}

export interface GroupDownloadInfo {
    status: DownloadStatus;
    when: number;
    files: Record<string, DownloadFileInfo>;
}

export type GroupDownloadStatusMap = Record<string, GroupDownloadInfo>;

export interface GroupDownloadStatusInfo {
    when: number;
    map: GroupDownloadStatusMap;
}

export interface DownloadErrorInfo {
    error?: string;
}


/**
 * This function will fetch the requested URL. It will parse the response
 * body as if it is a page of <li><a href=""> like lines. This matches the
 * output of the Subversion page that lists all of the themes or plugins.
 * The result is a list of the `href` values found on the page.
 * @param url
 * @returns
 */
export async function getHrefListFromPage(reporter: ConsoleReporter, url: string): Promise<Array<string>> {
    reporter(`reading list of hrefs...`);
    reporter(`fetch(${url})`);
    const response = await fetch(url);
    const re = /<li><a .*href="([^"]*)"/;
    const hrefs: Array<string> = [];
    if (!response.ok) {
        reporter(`fetch failed: ${response.status} ${response.statusText}`);
    } else {
        const html = await response.text();
        for (const line of html.split(/\r\n|\r|\n/)) {
            const found = line.match(re);
            if (Array.isArray(found) && (found.length > 1)) {
                hrefs.push(found[1]);
            }
        }
    }
    return hrefs;
}


async function sha256sum(contents: ArrayBuffer): Promise<string> {
    const sha256buffer = await crypto.subtle.digest('SHA-256', contents);
    const sha256array = Array.from(new Uint8Array(sha256buffer));
    const sha256 = sha256array.map((b) => b.toString(16).padStart(2, '0')).join('');
    return sha256;
}

async function md5sum(contents: ArrayBuffer): Promise<string> {
    const md5buffer = await crypto.subtle.digest('MD5', contents);
    const md5array = Array.from(new Uint8Array(md5buffer));
    const md5 = md5array.map((b) => b.toString(16).padStart(2, '0')).join('');
    return md5;
}

/**
 * Download a file, if required.
 * @param sourceUrl where to download the file.
 * @param targetFile where to put the file.
 * @returns true if download was successful, false if not.
 */
export async function downloadFile(reporter: ConsoleReporter, sourceUrl: URL, targetFile: string, force: boolean = false): Promise<DownloadFileInfo> {
    let needed = false;
    try {
        const fileInfo = await Deno.lstat(targetFile)
        if (!fileInfo.isFile || force) {
            await Deno.remove(targetFile, { recursive: true });
            needed = true;
        }
    } catch (_) {
        needed = true;
    }
    let sha256;
    let md5;
    if (needed) {
        reporter(`fetch(${sourceUrl}) > ${targetFile}`);
        const response = await fetch(sourceUrl);
        if (!response.ok) {
            return {
                filename: targetFile,
                status: 'failed',
                when: Date.now()
            };
        }
        const contents = await response.bytes();
        try {
            sha256 = await sha256sum(contents);
            md5 = await md5sum(contents);
            Deno.writeFile(targetFile, contents, { mode: 0o644 })
        } catch (_) {
            console.error(`Error: unable to save file: ${targetFile}`);
            return {
                filename: targetFile,
                status: 'failed',
                when: Date.now()
            };
        }
    } else {
        try {
            const contents = await Deno.readFile(targetFile);
            sha256 = await sha256sum(contents.buffer);
            md5 = await md5sum(contents.buffer);
        } catch (_) {
            console.error(`Error: unable to read file to compute hashes: ${targetFile}`);
            return {
                filename: targetFile,
                status: 'failed',
                when: Date.now(),
            };
        }
    }
    return {
        filename: targetFile,
        status: 'full',
        when: Date.now(),
        sha256,
        md5
    };
}


/**
 * Load the status of the downloads.
 * @param statusFilename where the data is persisted.
 * @param slugs list of slugs.
 * @returns map of download status.
 */
export async function readDownloadStatus(statusFilename: string, slugs: Array<string>): Promise<GroupDownloadStatusInfo> {
    const info: GroupDownloadStatusInfo = { when: 0, map: {} };
    try {
        const contents = await Deno.readTextFile(statusFilename);
        const json = JSON.parse(contents);
        const original = json as GroupDownloadStatusInfo;
        if (typeof original.when === 'number') {
            info.when = original.when;
        }
        for (const slug of Object.keys(original.map)) {
            if ((typeof original.map[slug] === 'object') &&
                (typeof original.map[slug]?.status === 'string') &&
                (typeof original.map[slug]?.when === 'number') &&
                (original.map[slug]?.status !== 'unknown')) {
                info.map[slug] = original.map[slug];
                if (typeof info.map[slug]?.files !== 'object') {
                    info.map[slug].files = {};
                }
            } else {
                info.map[slug] = { status: 'unknown', when: 0, files: {} };
            }
        }
    } catch (_) {
        slugs.forEach((s) => info.map[s] = { status: 'unknown', when: 0, files: {} });
    }
    return info;
}

/**
 * Persist the download status.
 * @param options command-line options.
 * @param info information about download statuses.
 * @returns true if save ok, false otherwise.
 */
export async function saveDownloadStatus(statusFilename: string, info: GroupDownloadStatusInfo): Promise<boolean> {
    try {
        const text = JSON.stringify(info, null, '    ');
        await Deno.writeTextFile(statusFilename, text);
    } catch (_) {
        console.error(`Error: unable to save file ${statusFilename}`)
        return false;
    }
    return true;
}
