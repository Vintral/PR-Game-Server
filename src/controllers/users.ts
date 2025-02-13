import logger from '../logger';
import dbase from '../database';
import { RowDataPacket } from 'mysql2/promise';
import { JSONObject } from '../interfaces';
import { User } from '../models';

export default class UsersController {
    private _debug:boolean = true;

    public async process( data:JSONObject, user:User ):Promise<JSONObject> {
        try {
            switch( data.command ) {
                case 'search_users': return { type:'SEARCH', data: await this.searchUsers( data, user ) };
                case 'get_contacts': return { type:'CONTACTS', data: await this.getContacts( user ) };
                case 'get_profile': return { type:'PROFILE', data: await this.getProfile( data, user ) };
                case 'add_friend': return { type:'FRIEND_ADDED', data: await this.addFriend( data, user ) };
                case 'remove_friend': return { type:'FRIEND_REMOVED', data: await this.removeFriend( data, user ) };
                case 'add_enemy': return { type:'ENEMY_ADDED', data: await this.addEnemy( data, user ) };
                case 'remove_enemy': return { type:'ENEMY_REMOVED', data: await this.removeEnemy( data, user ) };
                case 'block': return { type:'BLOCKED', data: await this.block( data, user ) };
                case 'unblock': return { type:'UNBLOCKED', data: await this.unblock( data, user ) };
                default: console.log( 'Unhandled Command: ' + data.command );
            }
        } catch( err ) {
            logger.logError( 'UsersController: ' + err );
        }

        return { type:'ERROR', data:'Contacts Error' };
    }

    private async searchUsers( data:JSONObject, user:User ):Promise<JSONObject> {
        this.debug( 'searchUsers' );

        const needle:string = data.search;
        const page:number = +data.page || 1;
        const perPage:number = +data.perPage || 30;

        const query:string = `SELECT username, avatar, power, land FROM ( SELECT username, avatar, power, land, ( CASE WHEN username = ? THEN 1 WHEN username LIKE ? THEN 2 WHEN username LIKE ? THEN 3 END ) AS score FROM users LEFT JOIN users_rounds ON users_rounds.userid = users.id AND roundid = ? ) AS results WHERE score >= 1 ORDER BY score LIMIT ?,?`;
        const results:RowDataPacket[] = await dbase.get( query, [ needle, needle + '%', '%' + needle + '%', user.round, ( page - 1 ) * perPage, perPage ] );

        return {
            page,
            search: needle,
            results,
        }
    }

    private async getProfile( data:JSONObject, user:User ):Promise<JSONObject> {
        this.debug( 'getProfile' );

        console.log( data );
        console.log( data.name );
        
        const queries = {
            info: `SELECT users.id, username, avatar, power, land, gold, food, wood, stone, metal FROM users LEFT JOIN users_rounds ON users_rounds.userid = users.id AND roundid = ? WHERE username = ?`,
            contact: `SELECT type FROM contacts WHERE userid = ? AND contactid = ?`
        };

        const userData:RowDataPacket = await dbase.getOne( queries.info, [ user.round, data.name ] );
        console.log( userData );

        const ret:JSONObject = {};

        ret.name = userData.username;
        ret.avatar = userData.avatar;
        ret.land = Math.floor( userData.land );
        ret.gold = Math.floor( userData.gold );
        ret.food = Math.floor( userData.food );
        ret.power = Math.floor( userData.power );
        ret.stone = Math.floor( userData.stone );
        ret.wood = Math.floor( userData.wood );
        ret.metal = Math.floor( userData.metal );

        if( userData.land ) ret.playing = true;
        ret.friend = false;
        ret.enemy = false;
        ret.blocked = false;

        const contactData:RowDataPacket[] = await dbase.get( queries.contact, [ user.id, userData.id ] );
        for( let i:number = 0; i < contactData.length; i++ ) {
            ret[ contactData[ i ].type ] = true;
        }

        return ret;

		/*const userInfoQuery = "SELECT users.id, username, avatar FROM users WHERE username = '" + $username + "'";
		const userInfo = await dbase.getOne( userInfoQuery );
		if( !userInfo ) {
			logger.logError( "Error Looking Up User: " + userInfoQuery );
			return this.dispatchError( "Unknown user" );
		}
		
		ret.username = userInfo.username;
		ret.avatar = userInfo.avatar;

		if( this.currentRound ) {
			const userRoundQuery = "SELECT land, gold, food, wood, stone, metal FROM users_rounds WHERE userid = " + userInfo.id + " AND roundid = " + this.currentRound;
			const roundInfo = await dbase.getOne( userRoundQuery );
			if( roundInfo ) {
				ret.land = Math.floor( roundInfo.land );
				ret.gold = Math.floor( roundInfo.gold );
				ret.food = Math.floor( roundInfo.food );
				ret.stone = Math.floor( roundInfo.stone );
				ret.wood = Math.floor( roundInfo.wood );
				ret.metal = Math.floor( roundInfo.metal );
			}
		}
		
		const contactQuery = "SELECT type FROM contacts WHERE userid = " + this.id + " AND contactid = " + userInfo.id;
		const contactInfo = await dbase.get( contactQuery );
		if( contactInfo ) {
			for( var c in contactInfo ) {
				ret[ contactInfo[ c ].type ] = 1;
			}
		}
		
		this.dispatch( "USER_INFO_RETRIEVED", ret );	*/
        
        //return {};
    }

    private async getIDFromName( name:string ):Promise<number> {
        this.debug( 'getIDFromName: ' + name );

        const query:string = `SELECT id FROM users WHERE username = ?`;
        const data:RowDataPacket = await dbase.getOne( query, [ name ] );        
        return data ? data.id : -1; 
    }

    private async contactExists( user:number, contact:number, type:string ):Promise<boolean> {
        const query:string = `SELECT id FROM contacts WHERE userid = ? AND contactid = ? AND type = ?`;
        const result:RowDataPacket = await dbase.getOne( query, [ user, contact, type ] );
        return result;// !== null;
    }

    private async saveContact( user:number, contact:number, type:string ):Promise<boolean> {
        const query:string = `INSERT INTO contacts SET userid = ?, contactid = ?, type = ?`;
        const result:RowDataPacket = await dbase.query( query, [ user, contact, type ] );
        return result[ 0 ].affectedRows === 1;
    }

    private async removeContact( user:number, contact:number, type:string ):Promise<boolean> {
        const query:string = `DELETE FROM contacts WHERE userid = ? AND contactid = ? AND type = ?`;
        const result:RowDataPacket = await dbase.query( query, [ user, contact, type ] );
        return result[ 0 ].affectedRows === 1;
    }

    private async getContactInfo( user:User, id:number ):Promise<JSONObject> {
        this.debug( 'getContactInfo: ' + id );

        const query:string = `SELECT username, avatar, last_seen, users_rounds.id AS playing FROM users LEFT JOIN users_rounds ON users.id = users_rounds.userid AND roundid = ? WHERE users.id = ?`
        const result:RowDataPacket = await dbase.getOne( query, [ user.round, id ] );

        console.log( query );
        console.log( id );
        console.log( user.round );
        console.log( result );

        const { username, avatar, last_seen, playing } = result;
        return { username, avatar, last_seen, playing:playing !== null };
    }

    private async addFriend( data:JSONObject, user:User ):Promise<JSONObject> {
        this.debug( 'addFriend: ' + data.name + ' - ' + user.id );

        const id:number = await this.getIDFromName( data.name );
        if( id === -1 ) throw new Error( 'User ' + data.name + ' Not Found' );

        const check:boolean = await this.contactExists( user.id, id, 'friend' );
        if( check ) throw new Error( 'Friend Already Exists' );

        const success:boolean = await this.saveContact( user.id, id, 'friend' );
        if( success ) return this.getContactInfo( user, id );

        throw new Error( 'Error Adding Friend' );
    }

    private async removeFriend( data:JSONObject, user:User ):Promise<JSONObject> {
        this.debug( 'removeFriend: ' + data.name + ' - ' + user.id );
        
        const id:number = await this.getIDFromName( data.name );
        if( id === -1 ) throw new Error( 'User ' + data.name + ' Not Found' );

        const check:boolean = await this.contactExists( user.id, id, 'friend' );
        if( !check ) throw new Error( 'Not A Friend' );

        const success:boolean = await this.removeContact( user.id, id, 'friend' );        
        if( success ) return this.getContactInfo( user, id );

        throw new Error( 'Error Removing Friend' );
    }

    private async addEnemy( data:JSONObject, user:User ):Promise<JSONObject> {
        this.debug( 'addEnemy: ' + data.name + ' - ' + user.id );
        
        const id:number = await this.getIDFromName( data.name );
        if( id === -1 ) throw new Error( 'User ' + data.name + ' Not Found' );

        const check:boolean = await this.contactExists( user.id, id, 'enemy' );
        if( check ) throw new Error( 'Enemy Already Exists' );

        const success:boolean = await this.saveContact( user.id, id, 'enemy' );
        if( success ) return this.getContactInfo( user, id );

        throw new Error( 'Error Adding Enemy' );
    }

    private async removeEnemy( data:JSONObject, user:User ):Promise<JSONObject> {
        this.debug( 'removeEnemy: ' + data.name + ' - ' + user.id );
        
        const id:number = await this.getIDFromName( data.name );
        if( id === -1 ) throw new Error( 'User ' + data.name + ' Not Found' );

        const check:boolean = await this.contactExists( user.id, id, 'enemy' );
        if( !check ) throw new Error( 'Not An Enemy' );

        const success:boolean = await this.removeContact( user.id, id, 'enemy' );
        if( success ) return this.getContactInfo( user, id );

        throw new Error( 'Error Removing Enemy' );
    }

    private async block( data:JSONObject, user:User ):Promise<JSONObject> {
        this.debug( 'block: ' + data.name + ' - ' + user.id );
        
        const id:number = await this.getIDFromName( data.name );
        if( id === -1 ) throw new Error( 'User ' + data.name + ' Not Found' );

        const check:boolean = await this.contactExists( user.id, id, 'blocked' );
        if( check ) throw new Error( 'Already Blocked' );

        const success:boolean = await this.saveContact( user.id, id, 'blocked' );
        if( success ) return this.getContactInfo( user, id );

        throw new Error( 'Error Blocking' )
    }

    private async unblock( data:JSONObject, user:User ):Promise<JSONObject> {
        this.debug( 'unblock: ' + data.name + ' - ' + user.id );
        
        const id:number = await this.getIDFromName( data.name );
        if( id === -1 ) throw new Error( 'User ' + data.name + ' Not Found' );

        const check:boolean = await this.contactExists( user.id, id, 'blocked' );
        if( !check ) throw new Error( 'Not Blocked' );

        const success:boolean = await this.removeContact( user.id, id, 'blocked' );
        if( success ) return this.getContactInfo( user, id );        

        throw new Error( 'Error Unblocking' );
    }

    private async getContactsByType( user:User, type:string ):Promise<JSONObject> {        
        const query:string = `SELECT avatar, username, ( UNIX_TIMESTAMP() - last_seen ) AS last_seen, type, users_rounds.id AS playing FROM contacts LEFT JOIN users_rounds ON users_rounds.userid = contacts.contactid AND roundid = ? INNER JOIN users ON contacts.contactid = users.id WHERE contacts.userid = ? AND type = ?`
        const result:RowDataPacket[] = await dbase.get( query, [ user.round, user.id, type ] );
        return result;
    }

    private async getContacts( user:User ):Promise<JSONObject> {
        this.debug( 'getContacts' );

        /*const query = {
            friends: `SELECT username, avatar, last_seen, users_rounds.id AS playing FROM users LEFT JOIN users_rounds ON users.id = users_rounds.userid WHERE users.id = ? AND users_rounds.roundid = ?`
        }
        const query:string = `SELECT username, avatar, last_seen, users_rounds.id AS playing FROM users LEFT JOIN users_rounds ON users.id = users_rounds.userid WHERE users.id = ? AND users_rounds.roundid = ?`
        const result:RowDataPacket = await dbase.getOne( query, [ id, user.round ] );*/        

        const friends:JSONObject = await this.getContactsByType( user, 'friend' );
        const enemies:JSONObject = await this.getContactsByType( user, 'enemy' );
        const blocked:JSONObject = await this.getContactsByType( user, 'blocked' );
        return { friends, enemies, blocked };
    }

    private debug( msg:string ):void {        
        if( this._debug )
            logger.logServer( 'UsersController: ' + msg );
    }
}