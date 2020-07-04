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
            case 'update_email': return await this.updateEmail( data, user );
            case 'update_password': return await this.updatePassword( data, user );
            case 'notification_setting': return await this.updateNotificationSetting( data, user );
            case 'notifications_enabled': return await this.updateNotificationsEnabled( data, user );
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

    private async updateNotificationSetting( data:JSONObject, user:User ):Promise<JSONObject> {
        this.debug( 'updateNotificationSetting' );
        console.log( data );

        const queries:JSONObject = {
            check: `SELECT id FROM users_notifications_settings WHERE userid = ? AND type = ?`,
            insert: `INSERT INTO users_notifications_settings ( userid, type ) VALUES ( ?, ? )`,
            remove: `DELETE FROM users_notifications_settings WHERE userid = ? AND type = ?`
        };

        if( data.value ) {
            let result:RowDataPacket = await dbase.getOne( queries.check, [ user.id, data.type ] );
            if( result ) return { type: 'NOTIFICATIONs_ENABLED_UPDATED' };
            else {
                result = await dbase.query( queries.insert, [ user.id,data.type] );
                if( result[ 0 ].affectedRows !== 1 ) logger.logError( 'Updating Notification Setting: user(' + user.id + '): ' + data.type + ' - ' + data.value );

                return { type: 'NOTIFICATIONs_ENABLED_UPDATED' };
            }
        }

        let result:RowDataPacket = await dbase.query( queries.remove, [ user.id, data.type ] );
        if( result[ 0 ].affectedRows !== 1 ) logger.logError( 'Updating Notification Setting: user(' + user.id + '): ' + data.type + ' - ' + data.value );

        return { type: 'NOTIFICATIONs_ENABLED_UPDATED' };
    }

    private async updateNotificationsEnabled( data:JSONObject, user:User ):Promise<JSONObject> {
        this.debug( 'updateNotificationsEnabled' );

        const queries:JSONObject = {
            check: `SELECT id FROM users_notifications_settings WHERE userid = ? AND type = ?`,
            insert: `INSERT INTO users_notifications_settings ( userid, type ) VALUES ( ?, ? )`,
            remove: `DELETE FROM users_notifications_settings WHERE userid = ? AND type = ?`
        };

        if( data.value ) {
            let result:RowDataPacket = await dbase.getOne( queries.check, [ user.id, 'enabled' ] );
            if( result ) return { type: 'NOTIFICATIONs_ENABLED_UPDATED' };
            else {
                result = await dbase.query( queries.insert, [ user.id, 'enabled' ] );
                if( result[ 0 ].affectedRows !== 1 ) logger.logError( 'Updating Notification Setting: user(' + user.id + '): Enabled' );

                return { type: 'NOTIFICATIONs_ENABLED_UPDATED' };
            }
        }

        let result:RowDataPacket = await dbase.query( queries.remove, [ user.id, 'enabled' ] );
        if( result[ 0 ].affectedRows !== 1 ) logger.logError( 'Updating Notification Setting: user(' + user.id + '): Disabled' );

        return { type: 'NOTIFICATIONs_ENABLED_UPDATED' };                
    }

    private async checkPassword( password:string, user:User ):Promise<boolean> {
        this.debug( 'checkPassword' );
        
        const data:RowDataPacket = await dbase.getOne( 'SELECT password FROM users WHERE id = ? LIMIT 1', [ user.id ] );
        if( data ) {
            const compare:boolean = await bcrypt.compare( password, data.password );
            return compare;
        }

        return false;
    }

    private async updatePassword( data:JSONObject, user:User ):Promise<JSONObject> {
        this.debug( 'updatePassword' );
        
        if( await this.checkPassword( data.current, user ) ) {
            const salt = await bcrypt.genSalt( 5 );
            const hashed = await bcrypt.hash( data.password, salt );
            const result:RowDataPacket = await dbase.query( `UPDATE users SET password = ? WHERE id = ?`, [ hashed, user.id ] );

            if( result[ 0 ].affectedRows === 1 ) return { type:'PASSWORD_CHANGED' };
            else return { type:'ERROR', data:'Error Changing Password' };
        } else return { type:'ERROR', data:'Error Changing Password' };
    }

    private async updateEmail( data:JSONObject, user:User ):Promise<JSONObject> {
        this.debug( 'updateEmail' );
        
        if( await this.checkPassword( data.password, user ) ) {
            const result:RowDataPacket = await dbase.query( `UPDATE users SET email = ? WHERE id = ?`, [ data.email, user.id ] );
            if( result[ 0 ].affectedRows === 1 ) return { type:'EMAIL_CHANGED' };
            else return { type:'ERROR', data:'Error Changing Email' };
        } else return { type:'ERROR', data:'Error Changing Email' };
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
                success = await user.addItem( data.item, 5 );
                if( success ) return { type:'ITEM_BOUGHT', data:{ item:data.item, name:result.name } };
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