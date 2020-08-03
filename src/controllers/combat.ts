import logger from '../logger';
import dbase from '../database';
import { RowDataPacket } from 'mysql2/promise';
import { JSONObject } from '../interfaces';
import { User, Combat } from '../models';
import { UserController } from '.';
import { UnitsProvider } from '../providers';
import chalk from 'chalk';
import { LAND_PRECISION } from '../constants';

export default class CombatController {
  private _debug: boolean = true;
  private _userController:UserController;
  private _units:UnitsProvider;
  private _redis:any;

  constructor( controller:UserController, provider:UnitsProvider, redis:any ) {
    this._userController = controller;
    this._units = provider;
    this._redis = redis;
  }

  public async process(data: JSONObject, user: User): Promise<JSONObject> {    
    try{
      switch (data.command) {
        case 'raid': return await this.raid( data, user ); break;
        case 'attack': return await this.attack( data, user ); break;      
        case 'get_targets': return await this.getTargets( user ); break;
        case 'get_fights': return await this.getFights( data, user ); break;
        default: console.log( 'Unhandled Command: ' + data.command ); break;
      }
    } catch( err ) {    
      const code:number = parseInt( ( err as Error ).message );
      if( isNaN( code ) ) {
        console.log( 'ERROR: ' + err );
        process.exit( 1 );
      }
      
      switch( code ) {
        case 1: err = 'Not Enough Energy'; break;
        case 2: err = 'Out Of Range'; break;
        case 3: err = 'You Have No Army'; break;
      }

      console.log( chalk.red( 'ERROR: ' + err ) );

      return { type:'ERROR', data:'attack-' + code };
    }

    return {};
  }

  private async raid( data:JSONObject, user:User ):Promise<JSONObject> {
    this.debug( 'raid' );
    
    console.log( data );
    console.log( user.energy );
    user.dumpEnergy();

    let defender:User|null = await this._userController.load( data.target, user.round );
    if( defender === null ) return {};

    const combat:Combat = new Combat( user, defender, this._units, this._redis );
    const result:JSONObject = await combat.raid();

    user.dumpEnergy();

    return { type:'COMBAT_DONE', data: { user:user.trimDetails(), combat:result } };
  }

  private async attack( data:JSONObject, user:User ):Promise<JSONObject> {
    this.debug( 'attack' );

    console.log( data );
    user.dumpEnergy();

    let defender:User|null = await this._userController.load( data.target, user.round );
    if( defender === null ) return {};

    const combat:Combat = new Combat( user, defender, this._units, this._redis );
    const result:JSONObject = await combat.attack();
    
    user.dumpEnergy();

    return { type:'COMBAT_DONE', data: { user:user.trimDetails(), combat:result } };
  }

  private async getTargets( user:User ):Promise<JSONObject> {
    this.debug( 'getTargets' );    

    const query:string = `SELECT username, avatar, power, land / ? AS land FROM users INNER JOIN users_rounds ON users.id = users_rounds.userid WHERE users.id <> ? AND roundid = ? AND power >= ? AND power <= ? LIMIT 15`;
    const result:RowDataPacket[] = await dbase.get( query, [ LAND_PRECISION, user.id, user.round, Math.ceil( user.power / 2 ), user.power * 2 ] );    

    return { type:'TARGETS', data:result };
  }

  private async getFights( data:JSONObject, user:User ):Promise<JSONObject> {
    this.debug( 'getFights' );

    console.log( data );

    let { page, perPage } = data;
    if( !page ) page = 1;
    if( !perPage ) perPage = 15;

    const queries:JSONObject = {
        retrieve: `SELECT fights.id, guid, type, attacker, defender, winner, UNIX_TIMESTAMP() - time AS ago, avatar, username, attacking_army, defending_army, combat, result, viewed FROM fights INNER JOIN users ON users.id = IF( attacker = ?, defender, attacker ) WHERE roundid = ? AND ( attacker = ? OR defender = ? ) ORDER BY fights.id DESC LIMIT ?,?`,
        markViewed: `UPDATE fights SET viewed = 1 WHERE defender = ? AND id >= ? AND id <= ?`,
        total: `SELECT COUNT(id) AS total FROM fights WHERE roundid = ? AND ( attacker = ? OR defender = ? )`
    }    
    const result:RowDataPacket[] = await dbase.get( queries.retrieve, [ user.id, user.round, user.id, user.id, ( page - 1 ) * perPage, perPage ] );        
    if( result ) await dbase.query( queries.markViewed, [ user.id, result[ result.length - 1 ].id, result[ 0 ].id ] );

    const count:RowDataPacket = await dbase.getOne( queries.total, [ user.round, user.id, user.id ] );

    return { 
        type:'FIGHTS',        
        data: {
            page: page,
            maxPages: Math.ceil( count.total / perPage ),
            fights: result.map( ( fight ) => { 
                return { 
                    guid:fight.guid, 
                    type:fight.type,
                    attacker:fight.attacker,
                    attacking_army:JSON.parse( fight.attacking_army ),
                    defender:fight.defender,
                    defending_army:JSON.parse( fight.defending_army ),
                    combat:JSON.parse( fight.combat ),
                    result:JSON.parse( fight.result ),
                    winner:fight.winner,
                    victory:fight.winner == user.id,
                    ago:fight.ago,
                    avatar:fight.avatar,
                    username:fight.username,
                    viewed:fight.viewed
                }
            } )
        } 
    };
  }

  private error(msg: string, type: string = 'ERROR'): JSONObject {
    console.log('ERROR: ' + msg);
    return { type, data: msg };
  }

  private debug(msg: string): void {
    if (this._debug)
      logger.logServer('CombatController: ' + msg);
  }
}