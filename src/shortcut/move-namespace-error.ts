import express = require( 'express' );

import { badRequest, movedPermanently, voidFunction } from '@app/utils';

export const init = voidFunction;

export function onRequest( req: express.Request, res: express.Response ) {
	const title = req.query.title;
	if ( title ) {
		const moveQuery = new URLSearchParams( {
			wpOldTitle: title as string,
			wpNewTitle: `Draft:${ title as string }`,
			wpReason: '由[[Wikipedia:建立條目|建立條目精靈]]建立但錯誤放置在主名字空間且未符合條目收錄要求的草稿'
		} );
		return movedPermanently( `https://zh.wikipedia.org/wiki/Special:MovePage?${ moveQuery.toString() }`, req, res );
	}
	return badRequest( req, res );
}
