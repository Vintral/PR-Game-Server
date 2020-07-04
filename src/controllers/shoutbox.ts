import logger from '../logger';
import dbase from '../database';
import * as WebSocket from 'websocket';
import { RowDataPacket } from 'mysql2/promise';
import { JSONObject } from '../interfaces';
import { User } from '../models';
import { Base64 } from 'js-base64';

export default class ShoutboxController {
    private _debug:boolean = true;

    public async process( data:JSONObject, user:User, connection:WebSocket.connection ):Promise<JSONObject> {        
        switch( data.command ) {
            case 'get_shouts': return { type:'SHOUTS', data: await this.getShouts( user ) };
            case 'join_shoutbox': return { type:'SHOUTBOX_JOINED', data: await this.joinShoutbox( user, connection ) };
            case 'leave_shoutbox': return { type:'SHOUTBOX_LEFT', data: await this.leaveShoutbox( user, connection  ) };
        }

        return { type:'ERROR', data:'Shoutbox Error' };
    }

    private async getShouts( user:User ):Promise<JSONObject> {
        this.debug( 'getShouts' );

        const query:string = `SELECT username, avatar, time, shout FROM shoutbox INNER JOIN users ON userid = users.id WHERE shoutbox.userid NOT IN ( SELECT contactid AS userid FROM contacts WHERE userid = ? AND type='blocked' ) ORDER BY shoutbox.id DESC LIMIT 20`;
        const result:RowDataPacket[] = await dbase.query( query, [ user.id ] );        

        for( let i:number = 0; i < result[ 0 ].length; i++ ) {
            result[ 0 ][ i ].shout = Base64.encode( result[ 0 ][ i ].shout );
        }        
        
        return result[ 0 ];
    }

    private async joinShoutbox( user:User, connection:WebSocket.connection ):Promise<JSONObject> {
        this.debug( 'joinShoutbox' );
        return {};
    }

    private async leaveShoutbox( user:User, connection:WebSocket.connection ):Promise<JSONObject> { 
        this.debug( 'leaveShoutbox' );
        return {}
    }

    private debug( msg:string ):void {        
        if( this._debug )
            logger.logServer( 'ShoutboxController: ' + msg );
    }
}