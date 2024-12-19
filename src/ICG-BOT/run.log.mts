import { execFile } from 'node:child_process';
import path from 'node:path';

import express from 'express';

export default function runLog( request: express.Request, response: express.Response ) {
	const query = new URLSearchParams( Object.entries( request.query ) as string[][] );
	let lines = Number.parseInt( query.get( 'lines' ) ?? '0', 10 );
	lines = lines && !Number.isNaN( lines ) && lines > 0 && lines < 2000 ? lines : 500;

	response.setHeader( 'Cache-Control', 'no-cache' );
	response.setHeader( 'Content-Type', 'no-cache' );
	response.type( 'text/plain;charset=UTF-8' );
	response.header( 'Content-Disposition', 'inline' );

	execFile( 'tail', [
		'-n',
		String( lines ),
		path.join( String( process.env.ICG_BOT_ROOT ), '/logs/run.log' ),
	], {}, function ( error, stdout, stderr ) {
		if ( error ) {
			response.status( 500 );
			response.send( stderr || error );
			response.end();
		} else {
			response.status( 200 );
			response.send( stdout );
			response.end();
		}
	} );
}
