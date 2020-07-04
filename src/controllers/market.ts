import logger from '../logger';
import dbase from '../database';
import { RowDataPacket } from 'mysql2/promise';
import * as WebSocket from 'websocket';
import { JSONObject } from '../interfaces';
import { User } from '../models';
import { Base64 } from 'js-base64';

export default class MarketsController {
    private _debug:boolean = true;

    public async process( data:JSONObject, user:User ):Promise<JSONObject> {        
        try {
            console.log( data );
            switch( data.command ) {                
                case 'market': return { type:'MARKET', data: await this.getMarketInfo( user ) };
            }
        } catch( err ) {
            console.log( 'ERROR: ' + err );
        }

        return { type:'ERROR', data:'Markets Error' };
    }

    private async getMarketInfo( user:User ):Promise<JSONObject> {
        this.debug( 'getMarketInfo' );

        const query:string = `SELECT type, price, ( total_sold - total_bought ) AS available FROM market WHERE roundid = ?`
        const result:RowDataPacket[] = await dbase.get( query, [ user.round ] );
        console.log( result );

        return {};
    }

    private debug( msg:string ):void {        
        if( this._debug )
            logger.logServer( 'MarketsController: ' + msg );
    }
}