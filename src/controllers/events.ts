import logger from '../logger';
import dbase from '../database';
import { RowDataPacket } from 'mysql2/promise';
import { JSONObject } from '../interfaces';
import { User } from '../models';
import { Base64 } from 'js-base64';

export default class EventsController {
    private _debug:boolean = true;

    public async process( data:JSONObject, user:User ):Promise<JSONObject> {        
        switch( data.command ) {
            case 'get_events': return { type:'EVENTS', data: await this.getEvents( user, data ) };
            case 'clear_events': { await this.clearEvents( user ); return { type:'EVENTS_CLEARED' }; }
        }

        return { type:'ERROR', data:'Avatars Error' };
    }

    private async clearEvents( user:User ):Promise<void> {
        this.debug( 'clearEvents' );

        const query:string = `UPDATE events SET deleted = 1 WHERE userid = ? AND roundid = ?`;
        const result:RowDataPacket[] = await dbase.query( query, [ user.id, user.round ] );        
    }

    private async getEvents( user:User, data:JSONObject ):Promise<JSONObject> {
        this.debug( 'getEvents: ' + data.page );
        
        const queries = {
            count: `SELECT COUNT(id) AS total FROM events WHERE userid = ? AND roundid = ? AND deleted = 0`,
            retrieve: `SELECT id, icon, type, event, unread, ( UNIX_TIMESTAMP() - time ) AS since FROM events WHERE userid = ? AND roundid = ? AND deleted = 0 ORDER BY id DESC LIMIT ?,?`
        }

        const count:RowDataPacket = await dbase.getOne( queries.count, [ user.id, user.round ] );

        const page:number = data.page || 0;
        const perPage:number = data.perPage || 20;
        const result:RowDataPacket[] = await dbase.get( queries.retrieve, [ user.id, user.round, page * perPage, perPage ] );
        
        return {
            page,
            pages: Math.ceil( count.total / perPage ),
            events: result.map( data => { 
                data.event = Base64.encode( data.event );
                return data;
            } )
        };
    }

    private debug( msg:string ):void {        
        if( this._debug )
            logger.logServer( 'EventsController: ' + msg );
    }
}