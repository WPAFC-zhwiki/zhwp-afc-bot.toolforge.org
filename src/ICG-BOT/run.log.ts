import express = require( 'express' );
import path = require( 'path' );
import { execFile } from 'child_process';

export default function ( req: express.Request, res: express.Response ) {
	const query = new URLSearchParams( Object.entries( req.query ) as string[][] );
	let lines = Number.parseInt( query.get( 'lines' ) ?? '0', 10 );
	lines = lines && !isNaN( lines ) && lines > 0 && lines < 2000 ? lines : 500;

	res.setHeader( 'Cache-Control', 'no-cache' );
	res.setHeader( 'Content-Type', 'no-cache' );
	res.type( 'text/plain' );
	res.setDefaultEncoding( 'utf8' );
	res.header( 'Content-Disposition', 'inline' );

	execFile( 'tail', [
		'-n',
		String( lines ),
		path.join( String( process.env.ICG_BOT_ROOT ), '/logs/run.log' )
	], {}, function ( error, stdout, stderr ) {
		if ( error ) {
			res.status( 500 );
			res.send( stderr || error );
			res.end();
		} else {
			res.status( 200 );
			res.send( stdout );
			res.end();
		}
	} );
}
