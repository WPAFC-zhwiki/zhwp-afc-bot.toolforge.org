import cheerio = require( 'cheerio' );
import express = require( 'express' );
import util = require( 'util' );
import winston = require( 'winston' );

import { ApiParams, ApiRevision, mwn, MwnTitle } from 'mwn';
import { ApiQueryRevisionsParams } from 'mwn/build/api_params';
import type { RawRequestParams } from 'mwn/build/core';

import { methodNoAllow } from '@app/utils';
import { getWithCacheAsync } from '@app/cache';

const $ = cheerio.load( '' );

let mwbot: mwn;

let abortController: AbortController | null;

export async function init() {
	// eslint-disable-next-line new-cap
	mwbot = new mwn( {
		apiUrl: 'https://zh.wikipedia.org/w/api.php'
	} );
	mwbot.rawRequest = function ( requestOptions: RawRequestParams ) {
		if ( abortController ) {
			requestOptions.signal = abortController.signal;
		}
		return mwn.prototype.rawRequest.call( this, requestOptions );
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
		'h6'

		// #id
		// 小作品標籤
		'#stub',
		// 目錄
		'#toc'

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
		'.afc-comment'
		
		// 其他
		// 討論頁工具
		// .ext-discussiontools-init-section 出現在 .mw-heading
		// .ext-discussiontools-init-timestamplink 出現在簽名時間戳
		'[class^=ext-discussiontools-init-]:not(.ext-discussiontools-init-section, .ext-discussiontools-init-timestamplink)'
	];
	const $countHTML = $parseHTML.clone();
	$countHTML.find( removeSelectors.join( ',' ) ).remove();
	const countText = $countHTML.text().replace( /\n/g, '' );
	const issues = [];
	const refs = {
		wt: ( wikitext.match( /<ref.*?>.*?<\/ref>/gi ) ?? [] ).map( function ( x, i ) {
			return [ String( i ), x ];
		} ),
		$ele: $parseHTML.find( 'ol.references' )
	};
	refs.$ele.find( '.mw-cite-backlink' ).remove();
	wikitext.replace( /<ref.*?>.*?<\/ref>/gi, '' );
	const extlink = $parseHTML.find( 'a' ).filter( function ( _i, a ) {
		try {
			return !$( a ).parents( '.ambox, .ombox, .fmbox, .dmbox, .stub, .afc-comment' ).length &&
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
			all: refs,

			default: refs.wt.filter( function ( [ _i, x ] ) {
				return !/group=/i.test( String( x ) );
			} ),
			$references: refs.$ele.filter( function ( _i, ele ) {
				return !!$( ele ).find( 'a, cite.citation' ).length;
			} ),
			$disallowed: refs.$ele.filter( function ( _i, ele ) {
				return !!String( $( ele ).html() )
					.match( /baike\.baidu\.com|百度|quora\.com|toutiao\.com|pincong\.rocks|zhihu\.com|知乎/ );
			} ),
			$unreliable: refs.$ele.filter( function ( _i, ele ) {
				return !!String( $( ele ).html() )
					.match( /百家[号號]|baijiahao\.baidu\.com|bigexam\.hk|boxun\.com|bowenpress\.com|hkgpao.com|peopo\.org|qyer\.com|speakout\.hk|songshuhui\.net|youtube\.com|youtu\.be|acfun\.cn|bilibili\.com/ );
			} )
		},
		extlinks: extlink,
		cats: wikitext.match( /\[\[(?:[Cc]at|[Cc]ategory|分[类類]):/gi ) ?? []
	};
	if ( !elements.extlinks.length ) {
		issues.push( 'no-extlink' );
	}
	const contentLen = countText.length - ( countText.match( /\p{L}/iu )?.length ?? 0 ) * 0.5;
	if ( contentLen === 0 ) {
		issues.push( 'size-zero' );
	} else if ( contentLen <= 50 ) {
		issues.push( 'substub' );
	} else if ( contentLen <= 220 ) {
		issues.push( 'stub' );
	} else if ( contentLen >= 15000 ) {
		issues.push( 'lengthy' );
	}
	if ( !/\[\[|\{\{|\{\||==|<ref|''|<code|<pre|<source|\[http|\|-|\|}|^[*#]/.test( wikitext ) ) {
		issues.push( 'wikify' );
	}
	if ( elements.refs.$references.length === 0 && elements.refs.all.$ele.length === 0 ) {
		issues.push( 'unreferenced' );
	} else {

		if ( elements.refs.$references.length < Math.min( Math.ceil( contentLen / 300 ) + 0.1, 20 ) ) {
			issues.push( 'ref-improve' );
		}
		if ( elements.refs.$disallowed.length ) {
			issues.push( 'ref-disallowed' );
		}
		if ( elements.refs.$unreliable.length ) {
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
		.replace( /<ref.*?<\/ref>/g, '' )
		.match( /(?:''|<(?:em|i|b)>|【)(?:.*?)(?:''|<\/(?:em|i|b)>|】)/g ) ?? [];
	const emCnt = em.length;
	if ( emCnt > ( wikitext.match( /==(?:.*?)==/g ) || [] ).length ) {
		issues.push( 'over-emphasize' );
	}
	if (
		wikitext.split( '\n' ).filter( function ( x ) {
			return x.match( /^\s+(?!$)/ );
		} ).length &&
		$parseHTML.find( 'pre' ).filter( function ( _i, ele ) {
			const $parent: cheerio.Cheerio<cheerio.Element> = $( ele ).parent().eq( 0 );
			// eslint-disable-next-line no-jquery/no-class-state
			return !$parent.hasClass( 'mw-highlight' );
		} ).length
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

export async function onRequest( req: express.Request, res: express.Response ) {
	if ( req.method.toUpperCase() !== 'GET' ) {
		return methodNoAllow( req, res );
	}
	abortController = new AbortController();

	let isRequestByPage = false;
	function doOutput( code: number, json: unknown ) {
		if ( !abortController ) {
			return;
		}
		try {
			res.status( code );
			if ( code < 400 ) {
				res.setHeader(
					'Cache-Control',
					isRequestByPage ? 'max-age=172800, must-revalidate' : 'max-age=172800'
				);
			}
			res.jsonp( json );
			res.end();
		} finally {
			abortController.abort();
			req.clearTimeout();
			abortController = null;
		}
	}

	req.on( 'timeout', function () {
		doOutput( 503, {
			status: 503,
			error: 'Timeout.'
		} );
	} );
	res.hasTimeoutResponse = true;

	const query = new URLSearchParams( Object.entries( req.query ) as string[][] );
	const requestParam: ApiQueryRevisionsParams = {
		action: 'query',
		prop: 'revisions',
		indexpageids: true,
		rvprop: [ 'ids', 'content', 'contentmodel' ],
		rvslots: 'main',
		formatversion: '2'
	};
	let requestInfo;
	try {
		if ( query.has( 'revid' ) && query.get( 'revid' ) ) {
			const revid = query.get( 'revid' ) ?? '';
			if ( revid.match( /[|,]/ ) ) {
				throw new Error( 'Only allow one revision in a request.' );
			} else if ( Number.isNaN( +revid ) || !Number.isInteger( +revid ) || revid.includes( '-' ) ) {
				throw new Error( `Revid "${ revid }" is invalid.` );
			}
			requestParam.revids = +revid;
			requestInfo = 'Revid ' + String( requestParam.revids );
		} else if ( query.has( 'pageid' ) && query.get( 'pageid' ) ) {
			const pageid = query.get( 'pageid' ) ?? '';
			if ( pageid.match( /[|,]/ ) ) {
				throw new Error( 'Only allow one page in a request.' );
			} else if ( Number.isNaN( +pageid ) || !Number.isInteger( +pageid ) || pageid.includes( '-' ) ) {
				throw new Error( `Pageid "${ pageid }" invalid.` );
			}
			isRequestByPage = true;
			requestParam.pageids = +pageid;
			requestInfo = `Pageid ${ String( requestParam.pageids ) }`;
		} else if ( query.has( 'title' ) && query.get( 'title' ) ) {
			const title = query.get( 'title' ) ?? '';
			let mTitle: MwnTitle;
			try {
				// eslint-disable-next-line new-cap
				mTitle = new mwbot.title( title );
			} catch ( e ) {
				throw new Error( `Title "${ title }" invalid.` );
			}
			isRequestByPage = true;
			requestParam.titles = mTitle.toText();
			requestInfo = `Title "${ requestParam.titles }"`;
		} else {
			throw new Error( 'At least one of the parameters "revid", "pageid" and "title" is required.' );
		}
	} catch ( error ) {
		doOutput( 400, {
			status: 400,
			error: error instanceof Error ? error.message : 'Parse request fail.'
		} );
		return;
	}
	try {
		const { query: apiQuery } = await mwbot.request( requestParam as ApiParams ) as ApiQueryRevisionsResponse;
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
				error: `Can't autoreview content model "${ rev.slots?.main.contentmodel }".`
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
					issues: issues
				}
			} );
		} else {
			winston.error( `[api/autoreview] getWithCacheAsync return ${ util.inspect( issues ) }.` );
			doOutput( 502, {
				status: 502,
				error: 'Bad gateway.'
			} );
		}
	} catch ( error ) {
		winston.error( `[api/autoreview] ${ util.inspect( error ) }` );
		doOutput( 500, {
			status: 500,
			error: error instanceof Error ? error.message : 'Request fail.'
		} );
	}
}
