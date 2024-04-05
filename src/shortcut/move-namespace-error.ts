import express = require( 'express' );

import { badRequest, movedPermanently, voidFunction } from '@app/utils';

export const init = voidFunction;

export function onRequest( req: express.Request, res: express.Response ) {
	try {
		const title = decodeURIComponent( String( req.query.title ?? '' ) ).trim();
		if ( title ) {
			const moveQuery = new URLSearchParams( {
				wpOldTitle: title,
				wpNewTitle: `Draft:${ title }`,
				wpReason: '由[[Wikipedia:建立條目|建立條目精靈]]建立但錯誤放置在主名字空間且未符合條目收錄要求的草稿',
				wpLeaveRedirect: '0'
			} );
			return movedPermanently( `https://zh.wikipedia.org/wiki/Special:MovePage?${ moveQuery.toString() }`, req, res );
		}
	} catch {
		// bad title, return bad request directly.
	}
	return badRequest( req, res );
}
