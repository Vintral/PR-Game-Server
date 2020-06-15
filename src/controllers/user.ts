import logger from '../logger';
import dbase from '../database';
import { RowDataPacket } from 'mysql2/promise';
import { JSONObject } from '../interfaces';
import * as bcrypt from 'bcryptjs';
import { User } from '../models';

export default class UserController {
    private _debug:boolean = true;

    public async process( data:JSONObject, user:User ):Promise<any> {        
        switch( data.command ) {
            case 'buy_premium_item': return await this.buyPremiumItem( data, user );
            case 'get_user_data': return { type:'USER_DATA', data: await this.getUserData( user ) };
            default: console.log( 'Unhandled Command: ' + data.command );
        }        
    }    

    public async login( username:string, password:string ):Promise<User|null> {
        username = Buffer.from( username, "base64" ).toString();
        password = Buffer.from( password, "base64" ).toString();
        this.debug( 'login: ' + username );

        const data:RowDataPacket = await dbase.getOne( 'SELECT id, password, username FROM users WHERE BINARY username = ? LIMIT 1', [ username ] );
        if( data ) {
            const compare = await bcrypt.compare( password, data.password );
            if( compare ) {
                const user = new User( data.id );
                await user.load();

                return user;
            }
        }

        return null;
    }

    public async load( username:string, round:number ):Promise<User|null> {
        const data:RowDataPacket = await dbase.getOne( 'SELECT id FROM users WHERE username = ?', [ username ] );
        if( data ) {
            const user:User = new User( data.id );
            await user.load( round );
            return user;
        }
        
        return null;
    }

    public async exists( username:string ):Promise<boolean> {
        username = Buffer.from( username, "base64" ).toString();
        this.debug( 'exists: ' + username );        

        const exists:RowDataPacket[] = await dbase.getOne( 'SELECT id FROM users WHERE username = ?', [ username ] );
        return exists ? true : false;        
    }

    private async buyPremiumItem( data:JSONObject, user:User ):Promise<JSONObject> {
        this.debug( 'buyPremiumItem' );

        const queries:JSONObject = {
            retrieve: `SELECT cost, available, name FROM items WHERE id = ?`,        
        }
        const result:RowDataPacket = await dbase.getOne( queries.retrieve, [ data.item ] );
        if( !result ) return { type:'BUY_ITEM_ERROR', data:'Item Not Found' };
        if( !result.available ) return { type:'BUY_ITEM_ERROR', data:'Item Not Available' };
        if( result.cost <= 0 ) return { type:'BUY_ITEM_ERROR', data:'Item Not Buyable' };

        if( await user.canAddItem() ) {
            if( user.gems < result.cost ) return { type:'BUY_ITEM_ERROR', data:'Cannot Afford That' }
            let success:boolean = await user.updateGems( -result.cost );
            if( !success ) return { type:'BUY_ITEM_ERROR', data:'Error Buying Item' };
            else {
                success = await user.addItem( data.item );
                if( success ) return { type:'ITEM_BOUGHT', data:result.name };
                else {
                    await user.updateGems( result.cost );
                    return { type:'BUY_ITEM_ERROR', data:'Error Buying Item' };
                }
            }
        } else return { type:'BUY_ITEM_ERROR', data:'No Room In Vault' };
    }

    private async getUserData( user:User ):Promise<JSONObject> {
        this.debug( 'getUserData' );

        await user.load();
        const ret:JSONObject = user.trimDetails();
        console.log( ret );

        return ret;
    }

    private debug( msg:string ):void {        
        if( this._debug )
            logger.logServer( 'UserController: ' + msg );
    }
}