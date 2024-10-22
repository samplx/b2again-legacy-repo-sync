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

import { ParseOptions } from "jsr:@std/cli/parse-args";

/** default number of items processed between saves of the status file. */
export const DEFAULT_PACE: number = 25;

/** default number of characters in the directory prefix. */
export const DEFAULT_PREFIX_LENGTH: number = 2;

export type ItemTypeName = 'plugin' | 'theme';

export type ItemListOptions =
    'featured' | 'new' | 'popular' | 'updated' | 'defaults' | 'interesting' | 'subversion';

/**
 * Results of parsing the command-line.
 */
export interface CommandOptions {
    /** where to get information */
    apiHost: string;

    /** top-level directory where build results are to be stored. */
    documentRoot: string;

    /** URL address of the base of the download tree. */
    downloadsBaseUrl: string;

    /** where to get zip files */
    downloadsHost: string;

    /** true to force download of all files. */
    force: boolean;

    /** true if all files should be downloaded. */
    full: boolean;

    /** true if user requested help. */
    help: boolean;

    /** name of a file containing the 'interesting' subset of items. */
    interestingFilename: string;

    /** spaces when rendering JSON. */
    jsonSpaces: string;

    /** maximum number of items in list (as an optional string). */
    limit?: string;

    /** which list are we using. */
    list: ItemListOptions;

    /** if true, query API for lists of items, and report on them. */
    lists: boolean;

    /** name of JSON file containing the lists from the API server. */
    listsFilename: string;

    /** number of items processed between saves of the status file (as a string). */
    pace: string;

    /** how many characters to put in the directory prefix (as a string). */
    prefixLength: string;

    /** if true, only report errors. */
    quiet: boolean;

    /** flag indicating the message digest (hashes) should be recalculated. */
    rehash: boolean;

    /** where to get sources */
    repoHost: string;

    /** true if failures should be retried. */
    retry: boolean;

    /** name of JSON file containing the download status. */
    statusFilename: string;

    /** URL address of the support server. */
    supportBaseUrl: string;

    /** flag indicating more verbose output is desired. */
    verbose: boolean;

    /** flag indicating a request to print the version. */
    version: boolean;

    /**
     * a "hidden" flag used for debugging/testing.
     * If true, use a fixed list of slugs rather
     * than the large list from the subversion page.
     */
    DEBUG_USE_FIXED_SLUGS: boolean;

    /** rest of the arguments of the command-line. */
    _: Array<string>;
}

export function getParseOptions(itemType: ItemTypeName): ParseOptions {
    return {
        default: {
            apiHost: 'api.wordpress.org',
            documentRoot: 'build',
            downloadsBaseUrl: 'https://downloads.b2again.org/',
            downloadsHost: 'downloads.wordpress.org',
            force: false,
            full: false,
            help: false,
            interestingFilename: `interesting-${itemType}s.jsonc`,
            jsonSpaces: '    ',
            list: 'updated',
            lists: false,
            listsFilename: 'legacy-lists.json',
            pace: `${DEFAULT_PACE}`,
            prefixLength: `${DEFAULT_PREFIX_LENGTH}`,
            quiet: false,
            rehash: false,
            repoHost: `${itemType}s.svn.wordpress.org`,
            retry: false,
            statusFilename: `${itemType}s-status.json`,
            supportBaseUrl: 'https://support.b2again.org/',
            verbose: false,
            version: false,
            DEBUG_USE_FIXED_SLUGS: false,
        },
        boolean: [
            'force',
            'full',
            'help',
            'lists',
            'quiet',
            'rehash',
            'retry',
            'version',
            'verbose',
            'DEBUG_USE_FIXED_SLUGS'
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
}

/**
 * Provide help to the user.
 */
export function printHelp(programName: string, parseOptions: ParseOptions): void {
    console.log(`${programName} [options]`);
    console.log();
    console.log(`Options include [default value]:`);
    console.log(`--apiHost=host             [${parseOptions.default?.apiHost}]`);
    console.log(`    define where to load data.`);
    console.log(`--documentRoot=dir         [${parseOptions.default?.documentRoot}]`);
    console.log(`    define where save files.`);
    console.log(`--downloadsBaseUrl=url     [${parseOptions.default?.downloadsBaseUrl}]`);
    console.log(`    define downstream downloads host.`);
    console.log(`--downloadsHost=host       [${parseOptions.default?.downloadsHost}]`);
    console.log(`    define where to load zip files.`);
    console.log(`--force                    [${parseOptions.default?.force}]`);
    console.log(`    force download of files.`);
    console.log(`--full                     [${parseOptions.default?.full}]`);
    console.log(`    full archive. include all versions, screenshots, and previews`);
    console.log(`--help`);
    console.log(`    print this message and exit.`);
    console.log(`--interestingFilename=name [${parseOptions.default?.interestingFilename}]`);
    console.log(`    JSON w/comments file of interesting slugs.`);
    console.log(`--jsonSpaces=spaces        [${parseOptions.default?.jsonSpaces}]`);
    console.log(`    spaces used to delimit generated JSON files.`);
    console.log(`--limit=number             [none]`);
    console.log(`    maximum number of items in a list.`);
    console.log(`--list=kind                [${parseOptions.default?.list}]`);
    console.log(`    which list to use: subversion, defaults, featured, interesting, new, popular, updated.`);
    console.log(`--lists                    [${parseOptions.default?.lists}]`);
    console.log(`    load all lists and save to listsFilename.`);
    console.log(`--listsFilename=name       [${parseOptions.default?.listsFilename}]`);
    console.log(`    JSON file of lists of legacy information.`);
    console.log(`--pace=number              [${parseOptions.default?.pace}]`);
    console.log(`    number of items processed between status file saves.`);
    console.log(`--prefixLength=number      [${parseOptions.default?.prefixLength}]`);
    console.log(`    number of characters in directory prefix.`);
    console.log(`--quiet                    [${parseOptions.default?.quiet}]`);
    console.log(`    be quiet. supress non-error messages.`);
    console.log(`--rehash                   [${parseOptions.default?.rehash}]`);
    console.log(`    recalculate message digests (hashes).`);
    console.log(`--repoHost=host            [${parseOptions.default?.repoHost}]`);
    console.log(`    define where to load list of items from subversion.`);
    console.log(`--retry                    [${parseOptions.default?.retry}]`);
    console.log(`    retry to download failed files.`);
    console.log(`--statusFilename=name      [${parseOptions.default?.statusFilename}]`);
    console.log(`    define where to save status information.`);
    console.log(`--supportBaseUrl=url       [${parseOptions.default?.supportBaseUrl}]`);
    console.log(`    define downstream support host.`);
    console.log(`--verbose                  [${parseOptions.default?.verbose}]`);
    console.log(`    be verbose. include more informational messages.`);
    console.log(`--version`);
    console.log(`    print program version and exit.`);
}
