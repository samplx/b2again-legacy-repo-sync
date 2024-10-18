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

import * as path from "jsr:@std/path";

/** directory suffix used for the overflow directory */
const UNICODE_PREFIX_SUFFIX: string = '+';
/** end of the line for standard prefix */
const Z_CODE_POINT: number = 'z'.codePointAt(0) ?? 122;


/**
 * Get the Unicode directory prefix.
 * @param prefixLength how long is the directory prefix.
 * @returns a name used for `other` aka unicode names.
 */
function unicodePrefix(prefixLength: number): string {
    if (prefixLength > 0) {
        const zzzs = 'z'.repeat(prefixLength);
        return `${zzzs}${UNICODE_PREFIX_SUFFIX}`;
    }
    return '';
}

/**
 * Creates a directory name that may be split in order to
 * reduce the number of entries in any one directory.
 * With over 100k plugins, it is a performance hit to have
 * a directory with that many sub-directories. So, split the
 * name into a prefix of up-to some number of characters,
 * followed by the full name. Since there are not many
 * Unicode plugins/themes, we will put those all in a
 * single unicode prefix directory.
 * @param name slug used for a directory name.
 * @param prefixLength how many characters in the prefix, 0 = no split.
 * @returns directory name split at the prefix length.
 */
export function splitFilename(name: string, prefixLength: number = 2): string {
    if ((prefixLength > 0) && (name.length > 0)) {
        const nameFirst = name.codePointAt(0);
        if (nameFirst && (nameFirst > Z_CODE_POINT)) {
            const prefix = unicodePrefix(prefixLength);
            return path.join(prefix, name);
        }
        const prefix = name.substring(0, prefixLength);
        return path.join(prefix, name);
    }
    return name;
}

/**
 * Test a split to see how it does.
 * @param list names of plugins
 * @param prefixLength where to split
 */
export function printSplitSummary(list: Array<string>, prefixLength: number): void {
    const topLevel: Record<string, Array<string>> = {};
    for (const name of list) {
        if (name.length > 0) {
            const nameFirst = name.codePointAt(0);
            if (nameFirst && (nameFirst > Z_CODE_POINT)) {
                const prefix = unicodePrefix(prefixLength);
                if (!topLevel[prefix]) {
                    topLevel[prefix] = [ name ];
                } else {
                    topLevel[prefix].push(name);
                }
            } else {
                const first = name.substring(0, prefixLength);
                if (!topLevel[first]) {
                    topLevel[first] = [ name ];
                } else {
                    topLevel[first].push(name);
                }
            }
        }
    }
    let smallest: number = Number.MAX_SAFE_INTEGER;
    let smallestName: string = 'not defined';
    let largest: number = 0;
    let largestName: string = 'not defined';
    let total: number = 0;
    let count: number = 0;
    for (const bucket of Object.keys(topLevel)) {
        count += 1;
        const bucketSize = topLevel[bucket].length;
        total += bucketSize;
        if (bucketSize < smallest) {
            smallest = bucketSize;
            smallestName = bucket;
        }
        if (largest < bucketSize) {
            largest = bucketSize;
            largestName = bucket;
        }
    }
    const average = total / count;
    console.log(`prefix directory split breakdown`);
    console.log(`directory prefix of length:          ${prefixLength}`);
    console.log(`total number of entries:             ${list.length}`);
    console.log(`total number of prefix directories:  ${count}`);
    console.log(`largest prefix directory:            ${largest} "${largestName}"`);
    console.log(`smallest prefix directory:           ${smallest} "${smallestName}"`);
    console.log(`average prefix directory size:       ${average}`);
    console.log();
}
