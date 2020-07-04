import logger from '../logger';
import dbase from '../database';
import { RowDataPacket } from 'mysql2/promise';
import { JSONObject } from '../interfaces';
import { User } from '../models';

export default class ContactsController {
    private _debug:boolean = true;

    public async process( data:JSONObject, user:User ):Promise<JSONObject> {        
        switch( data.command ) {
            case 'get_contacts': return { type:'CONTACTS', data: await this.getContacts() };
        }

        return { type:'ERROR', data:'Contacts Error' };
    }

    private async getContacts():Promise<JSONObject> {
        this.debug( 'getContacts' );

        const friends:JSONObject[] = [];
        const enemies:JSONObject[] = [];
        const blocked:JSONObject[] = [];
        return { friends, enemies, blocked };
    }

    private debug( msg:string ):void {        
        if( this._debug )
            logger.logServer( 'ContactsController: ' + msg );
    }
}