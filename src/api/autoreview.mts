import { inspect } from 'node:util';

import { AxiosRequestConfig } from 'axios';
import * as cheerio from 'cheerio';
import express from 'express';
import { ApiParams, ApiRevision, Mwn, MwnTitle } from 'mwn';
import mwnPackageJson from 'mwn/package.json' with { type: 'json' };
import type { ApiQueryRevisionsParams } from 'types-mediawiki-api';
import winston from 'winston';

import { getWithCacheAsync } from '@app/cache/index.mjs';
import { userAgent, methodNoAllow } from '@app/utils.mjs';

const $ = cheerio.load( '' );

let mwbot: Mwn;

let abortController: AbortController | undefined;

export async function init() {

	mwbot = new Mwn( {
		apiUrl: 'https://zh.wikipedia.org/w/api.php',
		userAgent: `${ userAgent } mwn/${ mwnPackageJson.version }`,
	} );
	mwbot.rawRequest = function ( requestOptions: AxiosRequestConfig ) {
		if ( abortController ) {
			requestOptions.signal = abortController.signal;
		}
		return Mwn.prototype.rawRequest.call( this, requestOptions );
	};
	await mwbot.getSiteInfo();
}

function autoReview( wikitext: string, $parseHTML: cheerio.Cheerio<cheerio.AnyNode> ) {
	const removeSelectors = [
		// #tag
		// 表格
		'table',
		'tbody',
		'td',
		'tr',
		'th',
		// 樣式
		'style',
		// 標題常常解析出一堆亂象
		'h1',
		'h2',
		'h3',
		'h4',
		'h5',
		'h6',

		// #id
		// 小作品標籤
		'#stub',
		// 目錄
		'#toc',

		// #class
		// NoteTA
		'.noteTA',
		// 表格
		'.infobox',
		'.wikitable',
		'.navbox',
		// <syntaxhighlight>
		'.mw-highlight',
		// 圖片說明
		'.thumb',
		// <reference />
		'.reflist',
		'.references',
		'.reference',
		// 不印出來的
		'.noprint',
		'.hide-when-compact', // 主要出現在 ambox
		// 消歧義
		'.hatnote',
		'.navigation-not-searchable',
		// 目錄
		'.toc',
		// edit
		'.mw-editsection',
		// {{AFC comment}}
		'.afc-comment',

		// #其他
		// 討論頁工具
		// .ext-discussiontools-init-section 出現在 .mw-heading
		// .ext-discussiontools-init-timestamplink 出現在簽名時間戳
		'[class^=ext-discussiontools-init-]:not(.ext-discussiontools-init-section, .ext-discussiontools-init-timestamplink)',
	];
	const $countHTML = $parseHTML.clone();
	$countHTML.find( removeSelectors.join( ',' ) ).remove();
	const countText = $countHTML.text().replaceAll( '\n', '' );
	const issues = [];
	const references = {
		wt: ( wikitext.match( /<ref.*?>.*?<\/ref>/gi ) ?? [] ).map( function ( x, index ) {
			return [ String( index ), x ];
		} ),
		$ele: $parseHTML.find( 'ol.references' ),
	};
	references.$ele.find( '.mw-cite-backlink' ).remove();
	wikitext.replaceAll( /<ref.*?>.*?<\/ref>/gi, '' );
	const extlink = $parseHTML.find( 'a' ).filter( function ( _index, a ) {
		try {
			return $( a ).parents( '.ambox, .ombox, .fmbox, .dmbox, .stub, .afc-comment' ).length === 0 &&
				new URL( $( a ).attr( 'href' ) ?? '', 'https://zh.wikipedia.org/' ).hostname !== 'zh.wikipedia.org';
		} catch {
			return false;
		}
	} ).get().map( function ( a ) {
		return $( a ).prop( 'href' );
	} );
	const elements = {
		intLinks: wikitext.match( /\[\[.*?\]\]/g ),
		refs: {
			all: references,

			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			default: references.wt.filter( function ( [ _index, x ] ) {
				return !/group=/i.test( String( x ) );
			} ),
			$references: references.$ele.filter( function ( _index, ele ) {
				return $( ele ).find( 'a, cite.citation' ).length > 0;
			} ),
			$disallowed: references.$ele.filter( function ( _index, ele ) {
				return !!/baike\.baidu\.com|百度|quora\.com|toutiao\.com|pincong\.rocks|zhihu\.com|知乎/
					.test( String( $( ele ).html() ) );
			} ),
			$unreliable: references.$ele.filter( function ( _index, ele ) {
				return !!/百家[号號]|baijiahao\.baidu\.com|bigexam\.hk|boxun\.com|bowenpress\.com|hkgpao.com|peopo\.org|qyer\.com|speakout\.hk|songshuhui\.net|youtube\.com|youtu\.be|acfun\.cn|bilibili\.com/
					.test( String( $( ele ).html() ) );
			} ),
		},
		extlinks: extlink,
		cats: wikitext.match( /\[\[(?:[Cc]at|[Cc]ategory|分[类類]):/gi ) ?? [],
	};
	if ( elements.extlinks.length === 0 ) {
		issues.push( 'no-extlink' );
	}
	const contentLength = countText.length - ( countText.match( /\p{L}/iu )?.length ?? 0 ) * 0.5;
	if ( contentLength === 0 ) {
		issues.push( 'size-zero' );
	} else if ( contentLength <= 50 ) {
		issues.push( 'substub' );
	} else if ( contentLength <= 220 ) {
		issues.push( 'stub' );
	} else if ( contentLength >= 15_000 ) {
		issues.push( 'lengthy' );
	}
	if ( !/\[\[|\{\{|\{\||==|<ref|''|<code|<pre|<source|\[http|\|-|\|}|^[*#]/.test( wikitext ) ) {
		issues.push( 'wikify' );
	}
	if ( elements.refs.$references.length === 0 && elements.refs.all.$ele.length === 0 ) {
		issues.push( 'unreferenced' );
	} else {

		if ( elements.refs.$references.length < Math.min( Math.ceil( contentLength / 300 ) + 0.1, 20 ) ) {
			issues.push( 'ref-improve' );
		}
		if ( elements.refs.$disallowed.length > 0 ) {
			issues.push( 'ref-disallowed' );
		}
		if ( elements.refs.$unreliable.length > 0 ) {
			issues.push( 'ref-unreliable' );
		}
		if (
			elements.refs.$unreliable.length + elements.refs.$disallowed.length >=
			elements.refs.$references.length * 0.5
		) {
			issues.push( 'need-rs' );
		}
	}
	if ( elements.cats.length === 0 ) {
		issues.push( 'uncategorized' );
	}
	const em = wikitext
		.replaceAll( /<ref.*?<\/ref>/g, '' )
		.match( /(?:''|<(?:em|i|b)>|【)(?:.*?)(?:''|<\/(?:em|i|b)>|】)/g ) ?? [];
	const emCnt = em.length;
	if ( emCnt > ( wikitext.match( /==(?:.*?)==/g ) || [] ).length ) {
		issues.push( 'over-emphasize' );
	}
	if (
		wikitext.split( '\n' ).some( function ( x ) {
			return x.match( /^\s+(?!$)/ );
		} ) &&
		$parseHTML.find( 'pre' ).get().some( function ( ele ) {
			const $parent: cheerio.Cheerio<cheerio.Element> = $( ele ).parent().eq( 0 );
			return !$parent.hasClass( 'mw-highlight' );
		} )
	) {
		issues.push( 'bad-indents' );
	}
	return issues;
}

interface ApiQueryRevisionsResponse {
	query?: {
		pageids?: number[];
		pages?: ApiPage[];
	};
}

interface ApiPage {
	revisions?: ApiRevision[];
	ns: number;
	title: string;
}

export async function onRequest( request: express.Request, response: express.Response ) {
	if ( request.method.toUpperCase() !== 'GET' ) {
		return methodNoAllow( request, response );
	}
	abortController = new AbortController();

	let isRequestByPage = false;
	function doOutput( code: number, json: unknown ) {
		if ( !abortController ) {
			return;
		}
		try {
			response.status( code );
			if ( code < 400 ) {
				response.setHeader(
					'Cache-Control',
					isRequestByPage ? 'max-age=172800, must-revalidate' : 'max-age=172800'
				);
			}
			response.jsonp( json );
			response.end();
		} finally {
			abortController.abort();
			request.clearTimeout();
			abortController = undefined;
		}
	}

	request.on( 'timeout', function () {
		doOutput( 503, {
			status: 503,
			error: 'Timeout.',
		} );
	} );
	response.hasTimeoutResponse = true;

	const query = new URLSearchParams( Object.entries( request.query ) as string[][] );
	const requestParameter: ApiQueryRevisionsParams = {
		action: 'query',
		prop: 'revisions',
		indexpageids: true,
		rvprop: [ 'ids', 'content', 'contentmodel' ],
		rvslots: 'main',
		formatversion: '2',
	};
	let requestInfo;
	try {
		if ( query.has( 'revid' ) && query.get( 'revid' ) ) {
			const revId = query.get( 'revid' ) ?? '';
			if ( /[|,]/.test( revId ) ) {
				throw new Error( 'Only allow one revision in a request.' );
			} else if ( Number.isNaN( +revId ) || !Number.isInteger( +revId ) || revId.includes( '-' ) ) {
				throw new Error( `RevId "${ revId }" is invalid.` );
			}
			requestParameter.revids = +revId;
			requestInfo = 'RevId ' + String( requestParameter.revids );
		} else if ( query.has( 'pageid' ) && query.get( 'pageid' ) ) {
			const pageId = query.get( 'pageid' ) ?? '';
			if ( /[|,]/.test( pageId ) ) {
				throw new Error( 'Only allow one page in a request.' );
			} else if ( Number.isNaN( +pageId ) || !Number.isInteger( +pageId ) || pageId.includes( '-' ) ) {
				throw new Error( `PageId "${ pageId }" invalid.` );
			}
			isRequestByPage = true;
			requestParameter.pageids = +pageId;
			requestInfo = `PageId ${ String( requestParameter.pageids ) }`;
		} else if ( query.has( 'title' ) && query.get( 'title' ) ) {
			const title = query.get( 'title' ) ?? '';
			let mTitle: MwnTitle;
			try {

				mTitle = new mwbot.Title( title );
			} catch {
				throw new Error( `Title "${ title }" invalid.` );
			}
			isRequestByPage = true;
			requestParameter.titles = mTitle.toText();
			requestInfo = `Title "${ requestParameter.titles }"`;
		} else {
			throw new Error( 'At least one of the parameters "revid", "pageid" and "title" is required.' );
		}
	} catch ( error ) {
		doOutput( 400, {
			status: 400,
			error: error instanceof Error ? error.message : 'Parse request fail.',
		} );
		return;
	}
	try {
		const { query: apiQuery } = await mwbot.request( requestParameter as ApiParams ) as ApiQueryRevisionsResponse;
		if ( !apiQuery ) {
			throw new Error( 'Fail to get page info.' );
		}
		const pageid = apiQuery.pageids?.[ 0 ];
		const page = apiQuery.pages?.[ 0 ];
		const rev = page?.revisions?.[ 0 ];
		if ( !page || !rev ) {
			throw new Error( `${ requestInfo } isn't exist.` );
		} else if ( rev.slots?.main.contentmodel !== 'wikitext' ) {
			doOutput( 422, {
				status: 422,
				error: `Can't autoreview content model "${ rev.slots?.main.contentmodel }".`,
			} );
			return;
		}
		const issues = await getWithCacheAsync<string[]>(
			`api/autoreview/issues/${ rev.revid }`,
			5 * 60 * 1000,
			async () => {
				const parseHTML = await mwbot.parseTitle( page.title );
				return autoReview( rev.slots?.main.content ?? '', $( $.parseHTML( parseHTML ) ) );
			}
		);
		if ( issues ) {
			doOutput( 200, {
				status: 200,
				apiVersion: 1,
				result: {
					ns: page.ns,
					title: page.title,
					pageid: pageid,
					oldid: rev.revid,
					issues: issues,
				},
			} );
		} else {
			winston.error( `[api/autoreview] getWithCacheAsync return ${ inspect( issues ) }.` );
			doOutput( 502, {
				status: 502,
				error: 'Bad gateway.',
			} );
		}
	} catch ( error ) {
		winston.error( `[api/autoreview] ${ inspect( error ) }` );
		doOutput( 500, {
			status: 500,
			error: error instanceof Error ? error.message : 'Request fail.',
		} );
	}
}
