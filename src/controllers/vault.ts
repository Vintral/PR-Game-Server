import logger from '../logger';
import dbase from '../database';
import { RowDataPacket } from 'mysql2/promise';
import { JSONObject } from '../interfaces';
import { User } from '../models';
import { Base64 } from 'js-base64';

export default class VaultController {
    private _debug:boolean = true;

    public async process( data:JSONObject, user:User ):Promise<JSONObject> {        
        switch( data.command ) {
            case 'get_vault': return { type:'VAULT', data: await this.getItems( user ) };
            case 'use_item': return { type:'ITEM_USED', data: await this.useItem( user, data ) };
        }

        return { type:'ERROR', data:'Vault Error' };
    }

    /*private async clearEvents( user:User ):Promise<void> {
        this.debug( 'clearEvents' );

        const query:string = `UPDATE events SET deleted = 1 WHERE userid = ? AND roundid = ?`;
        const result:RowDataPacket[] = await dbase.query( query, [ user.id, user.round ] );        
    }*/

    private async getItems( user:User ):Promise<JSONObject> {
        this.debug( 'getItems' );

        const query:string = `SELECT itemid, quantity FROM users_vault WHERE userid = ? AND quantity > 0`;
        const result:RowDataPacket[] = await dbase.query( query, [ user.id ] );
        return result[ 0 ];
    }

    private async useItem( user:User, data:JSONObject ):Promise<JSONObject> {
        this.debug( 'useItem' );
        
        if( await user.useItem( data.item ) ) {
            const query:string = `SELECT * FROM items WHERE id = ?`;
            const result:RowDataPacket = await dbase.getOne( query, [ data.item ] );            

            const onUse:string = Buffer.from( result.onUse, 'base64' ).toString();
            console.log( onUse );
            eval( onUse );
            await user.commit();
        }

        return { user:user.trim(), item:data.item };
    }

    private debug( msg:string ):void {        
        if( this._debug )
            logger.logServer( 'VaultController: ' + msg );
    }
}