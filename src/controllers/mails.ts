import logger from '../logger';
import dbase from '../database';
import { RowDataPacket } from 'mysql2/promise';
import { JSONObject } from '../interfaces';
import { User } from '../models';
import { Base64 } from 'js-base64';

export default class MailsController {
    private _debug:boolean = true;

    public async process( data:JSONObject, user:User ):Promise<JSONObject> {        
        switch( data.command ) {
            case 'get_conversations': return { type:'CONVERSATIONS', data: await this.getConversations( user, data ) };            
        }

        return { type:'ERROR', data:'Conversations Error' };
    }

    private async getConversations( user:User, data:JSONObject ):Promise<JSONObject> {
        this.debug( 'getEvents: ' + data.page );
        
        const queries = {
            count: `SELECT COUNT(id) as total FROM ( SELECT conversations.id, COUNT(conversation) AS total FROM conversations INNER JOIN messages ON conversation = conversations.id AND ( ( sender_view = 1 AND sender = ? ) OR ( recipient_view = 1 ) ) WHERE user1 = ? OR user2 = ? GROUP BY conversation ) as A;`,
            retrieve: `SELECT * FROM ( SELECT username, avatar, message, ( UNIX_TIMESTAMP() - sent ) AS since, seen, sender FROM conversations INNER JOIN users ON users.id = IF( user1 = 2, user2, user1 ) INNER JOIN messages ON conversation = conversations.id WHERE ( user1 = ? OR user2 = ? ) AND ( ( sender_view = 1 AND sender = ? ) OR ( recipient_view = 1 ) ) ORDER BY sent DESC LIMIT 1 ) AS a LIMIT ?,?`,
        }
        
        const count:RowDataPacket = await dbase.getOne( queries.count, [ user.id, user.id, user.id ] );        

        const page:number = data.page || 0;
        const perPage:number = data.perPage || 20;
        const result:RowDataPacket[] = await dbase.get( queries.retrieve, [ user.id, user.id, user.id, page * perPage, perPage ] );

        return {
            page,
            pages: Math.ceil( count.total / perPage ),
            conversations: result.map( data => { 
                data.message = Base64.encode( data.message );
                return data;
            } )
        };
    }

    private debug( msg:string ):void {        
        if( this._debug )
            logger.logServer( 'MailsController: ' + msg );
    }
}