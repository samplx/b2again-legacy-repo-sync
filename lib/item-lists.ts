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

import { CommandOptions, ItemListOptions, ItemTypeName } from "./options.ts";
import { parse } from "jsr:@std/jsonc";
import * as path from "jsr:@std/path";
import { PluginInfo } from "./plugins.ts";
import { ThemeInfo } from "./themes.ts";
import { ConsoleReporter } from "./reporter.ts";
import { getHrefListFromPage } from "./downloads.ts";

export type ItemBrowseOptions = 'featured' | 'new' | 'popular' | 'updated';

export type ItemInfoType = PluginInfo | ThemeInfo;

export type ItemLists = Record<string, Array<ItemInfoType>>;

/**
 * Determine the URL to use to query a themes list.
 * @param apiHost where the API is.
 * @param pageNumber which page of data requested.
 * @param [browse=undefined] browse parameter to query_themes request (if any).
 * @returns
 */
function getItemListUrl(apiHost: string, itemType: ItemTypeName, pageNumber: number = 1, browse: undefined | ItemBrowseOptions = undefined): URL {
    const url = new URL(`/${itemType}s/info/1.2/`, `https://${apiHost}`);
    url.searchParams.append('action', `query_${itemType}s`);
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
async function getAPIItemList(reporter: ConsoleReporter, apiHost: string, itemType: ItemTypeName, browse: undefined | ItemBrowseOptions): Promise<Array<ItemInfoType>> {
    const collection: Array<ItemInfoType> = [];
    let pages: number = 1;
    let page: number = 1;
    while (page <= pages) {
        const url = getItemListUrl(apiHost, itemType, page, browse);
        reporter(`fetch(${url})`);
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
async function getInterestingList(reporter: ConsoleReporter, options: CommandOptions): Promise<Array<ItemInfoType>> {
    const list: Array<ItemInfoType> = [];
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
 * Extract a list of themes from an HTML page.
 * @param listUrl where to access the theme list
 * @returns list of theme slugs.
 */
async function getItemSlugs(reporter: ConsoleReporter, listUrl: string, fixedList: boolean = false): Promise<Array<string>> {
    if (fixedList) {
        return [
            '100-bytes',
            'acid-rain',
            decodeURIComponent('%e6%a0%bc%e5%ad%90-x') // unicode -- not found
        ];
    }
    const rawList = await getHrefListFromPage(reporter, listUrl);
    const slugs =
        rawList
            .filter(n => (n !== '..') && (n !== '../'))
            .map(n => decodeURIComponent(n.slice(0, -1)));
    return slugs;
}


/**
 * Query the API server to get a list of theme information.
 * @param apiHost where to get the list of themes.
 * @param browse what kind of request.
 * @returns list of theme's information.
 */
async function getUnlimitedItemList(reporter: ConsoleReporter, options: CommandOptions, itemType: ItemTypeName, kind: ItemListOptions): Promise<Array<ItemInfoType>> {
    if (kind === 'subversion') {
        const slugs = await getItemSlugs(reporter, `http://${options.repoHost}/`, options.DEBUG_USE_FIXED_SLUGS);
        const list: Array<ItemInfoType> = [];
        slugs.forEach((slug) => list.push({slug}));
        return list;
    }
    if (kind === 'interesting') {
        return await getInterestingList(reporter, options);
    }
    if (kind === 'defaults') {
        return await getAPIItemList(reporter, options.apiHost, itemType, undefined);
    }
    return await getAPIItemList(reporter, options.apiHost, itemType, kind);
}

/**
 * Query the API server to get list of theme information. Impose
 * any optional limit on the number of entires.
 * @param options where to get the list of themes.
 * @param kind what kind of request.
 * @returns list of theme's information possiblily limited.
 */
export async function getItemList(reporter: ConsoleReporter, options: CommandOptions, itemType: ItemTypeName, kind: ItemListOptions): Promise<Array<ItemInfoType>> {
    const list = await getUnlimitedItemList(reporter, options, itemType, kind);
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
export async function getItemLists(reporter: ConsoleReporter, options: CommandOptions, itemType: ItemTypeName): Promise<ItemLists> {
    const subversion = await getItemList(reporter, options, itemType, 'subversion');
    const defaults = await getItemList(reporter, options, itemType, 'defaults');
    const featured = await getItemList(reporter, options, itemType, 'featured');
    const introduced = await getItemList(reporter, options, itemType, 'new');
    const popular = await getItemList(reporter, options, itemType, 'popular');
    const updated = await getItemList(reporter, options, itemType, 'updated');
    let interesting: Array<ItemInfoType> = [];
    if (options.list === 'interesting') {
        interesting = await getItemList(reporter, options, itemType, 'interesting');
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
// function intersectionCount(list1: Array<ItemInfoType>, list2: Array<ItemInfoType>): number {
//     const map: Record<string, boolean> = {};
//     list2.forEach((info: ItemInfoType) => {
//         if (typeof info?.slug === 'string') {
//             map[info.slug] = true;
//         }
//     });
//     let count: number = 0;
//     list1.forEach((info: ItemInfoType) => {
//         if ((typeof info?.slug === 'string') && map[info.slug]) {
//             count += 1;
//         }

//     });
//     return count;
// }

export function itemListsReport(reporter: ConsoleReporter, lists: ItemLists) {
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

export async function saveItemLists(reporter: ConsoleReporter, options: CommandOptions, itemType: ItemTypeName, lists: ItemLists): Promise<void> {
    const text = JSON.stringify(lists, null, options.jsonSpaces);
    const dirname = path.join(options.documentRoot, `${itemType}s`, 'meta');
    await Deno.mkdir(dirname, { recursive: true });
    const filename = path.join(dirname, options.listsFilename);
    reporter(`save ${itemType} lists> ${filename}`);
    await Deno.writeTextFile(filename, text);
}
