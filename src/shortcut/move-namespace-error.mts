import express from 'express';

import { badRequest, movedPermanently } from '@app/utils.mjs';

export function onRequest( request: express.Request, response: express.Response ) {
	try {
		const title = decodeURIComponent( String( request.query.title ?? '' ) ).trim();
		if ( title ) {
			const moveQuery = new URLSearchParams( {
				wpOldTitle: title,
				wpNewTitle: `Draft:${ title }`,
				wpReason: '由[[Wikipedia:建立條目|建立條目精靈]]建立但錯誤放置在主名字空間且未符合條目收錄要求的草稿',
				wpLeaveRedirect: '0',
			} );
			return movedPermanently( `https://zh.wikipedia.org/wiki/Special:MovePage?${ moveQuery.toString() }`, request, response );
		}
	} catch {
		// bad title, return bad request directly.
	}
	return badRequest( request, response );
}

export { voidFunction as init } from '@app/utils.mjs';
