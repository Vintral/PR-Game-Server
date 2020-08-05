import logger from '../logger';
import dbase from '../database';
import { RowDataPacket } from 'mysql2/promise';
import { JSONObject } from '../interfaces';
import { User } from '../models';

export default class AvatarsController {
    private _debug:boolean = true;

    public async process( data:JSONObject, user:User ):Promise<JSONObject> {        
        switch( data.command ) {
            case 'get_avatars': return { type:'AVATARS', data: await this.getAvailableAvatars( user ) };
            case 'set_avatar': return { type:'AVATAR_SET', data: await this.setAvatar( user, data.avatar ) };
        }

        return { type:'ERROR', data:'Avatars Error' };
    }

    private async getAvatars():Promise<JSONObject> {
        this.debug( 'getAvatars' );

        const query:string = `SELECT path, sex AS gender FROM avatars WHERE available = 1`;
        const result:RowDataPacket[] = await dbase.get( query );

        return { type:'AVATARS', data: result.map( element => { return { path:element.path, gender:element.gender } } ) };
    }

    public async getAvatarsForUserID( user:number ):Promise<JSONObject> {
        this.debug( 'getAvatarsForUserID: ' + user.toString() );
        return await this.getAvatars();
    }

    public async setAvatarForUserID( data:JSONObject, user:number ):Promise<JSONObject> {
        this.debug( 'setAvatarForUserID: ' + user.toString() );

        const query:string = `UPDATE users SET avatar = ? WHERE id = ?`;
        const result:RowDataPacket = await dbase.query( query, [ data.avatar, user ] );
                
        if( result[ 0 ].affectedRows === 1 ) return { type:'AVATAR_SET' };
        else return { type:'ERROR', data:'avatar-generic' };
    }

    private async setAvatar( user:User, avatar:string ):Promise<JSONObject> {
        this.debug( 'setAvatar' );

        const query:string = `UPDATE users SET avatar = ? WHERE id = ?`;
        const result:RowDataPacket = await dbase.query( query, [ avatar, user.id ] );
                
        if( result[ 0 ].affectedRows === 1 ) {
            user.avatar = avatar;
            return { user: { avatar } }
        } else return {};
    }

    private async getAvailableAvatars( user:User ):Promise<JSONObject> {
        this.debug( 'getAvailableAvatars' );
        return await this.getAvatars();
    }

    private debug( msg:string ):void {        
        if( this._debug )
            logger.logServer( 'AvatarsController: ' + msg );
    }
}