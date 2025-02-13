import logger from '../logger';
import dbase from '../database';
import { RowDataPacket } from 'mysql2/promise';
import { JSONObject } from '../interfaces';
import { User } from '../models';

export default class AvatarsController {
    private _debug:boolean = true;

    public async process( data:JSONObject, user:User ):Promise<JSONObject> {        
        switch( data.command ) {
            case 'get_avatars': return { type:'AVATARS', data: await this.getAvatars( user ) };
            case 'set_avatar': return { type:'AVATAR_SET', data: await this.setAvatar( user, data.avatar ) };
        }

        return { type:'ERROR', data:'Avatars Error' };
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

    private async getAvatars( user:User ):Promise<JSONObject> {
        this.debug( 'getRules' );

        const query:string = `SELECT path FROM avatars WHERE available = 1 AND sex = ?`;
        const result:RowDataPacket[] = await dbase.get( query, [ user.sex ] );

        return result.map( element => { return element.path; } )
    }

    private debug( msg:string ):void {        
        if( this._debug )
            logger.logServer( 'AvatarsController: ' + msg );
    }
}