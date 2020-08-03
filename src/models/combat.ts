import { RowDataPacket } from 'mysql2/promise';
import dbase from '../database';
import logger from '../logger';
import { User, Army, Unit } from '.';
import { JSONObject } from '../interfaces';
import { UnitsProvider } from '../providers';

const { promisify } = require( 'util' );

let UUID = require( 'uuid/v4' );

export default class Combat {
  //==============================//
  //  Properties                  //
  //==============================//
  private _debug:boolean = false;
  private _provider:UnitsProvider;  

  private _id:number = -1;

  private _simulate:boolean = false;
  private _simulateTimes:number = 1;

  private _attacker:User;
  private _defender:User;

  private _attackingArmy:Army;
  private _defendingArmy:Army;

  private _round:number;

  private _energyAttack:number = 10;
  private _energyRaid:number = 5;

  private _victory:boolean = false;
  private _log:string[] = [];

  private _redis:any = '';
  private _getAsync:any = '';

  //==============================//
  //  Constructor                 //
  //==============================//
  constructor( attacker:User, defender:User, provider:UnitsProvider, redis:any ) {
    this._provider = provider;
    this._redis = redis;
    this._getAsync = promisify( this._redis.get ).bind( this._redis );

    this._attacker = attacker;
    this._attackingArmy = this.getArmy( this._attacker.units );

    this._defender = defender;
    this._defendingArmy = this.getArmy( this._defender.units );    
    
    this._round = attacker.round;    
  }

  //==============================//
  //  Methods                     //
  //==============================//
  public async load(): Promise<boolean> {
    return true;  
  }

  private getArmy( data:JSONObject ):Army {
    this.debug( 'getArmy' );

    let ret:Army = new Army();
    Object.keys( data ).forEach( key => {      
      let unit = this._provider.get( parseInt( key ) )?.clone();
      if( !unit ) return;

      unit.quantity = data[ key ];
      ret.add( unit );
    } );

    return ret;
  }

  private validate( energy:number ):void {
    if( this._attacker.energy < energy ) {
        this.debug( 'ENERGY: ' + this._attacker.energy + ' --- NEED: ' + energy );
        throw new Error( "1" );
    }
    if( ( this._defender.power > this._attacker.power * 2 ) || ( this._defender.power < this._attacker.power / 2 ) ) throw new Error( "2" );
    if( !this._attacker.units || Object.keys( this._attacker.units ).length === 0 ) throw new Error( "3" );
  }

  private async processUnitLosses( log:Array<JSONObject> ):Promise<JSONObject> {
    this.debug( 'processUnitLosses' );    

    if( !log || log.length === 0 ) return {};

    let attackerLosses = Array<JSONObject>();
    let defenderLosses = Array<JSONObject>();
    let losses:Array<number>;
    let ret:JSONObject = {};

    // Cycle through the log and split the losses
    log.forEach( fight => {
      if( fight.o == 'd' ) attackerLosses.push( fight );
      if( fight.o == 'a' ) defenderLosses.push( fight );
    } );

    if( this._debug ) {
        console.log( '--------------------------' );
        console.log( attackerLosses );
        console.log( defenderLosses );
        console.log( '--------------------------' );
    }
    
    // Go through all the attacker's losses and collapse down duplicates
    // Then cycle through and "kill" them
    losses = Array<number>();    
    attackerLosses.forEach( fight => {
      if( this._debug ) console.log( fight );
      if( losses[ fight.a ] ) losses[ fight.a ] += fight.k;
      else losses[ fight.a ] = fight.k;      
    } );
    ret.attacker = losses;
    if( this._debug ) console.log( losses );
    if( this._debug ) console.log( this._attackingArmy );
    for( let i:number = 0; i < losses.length; i++ ) {
        if( this._debug ) console.log( i );
        if( this._debug ) console.log( this._attackingArmy.units[ i ] );
      this._attacker.killUnit( this._attackingArmy.units[ i ].id, losses[ i ] );
    }

    if( this._debug ) console.log( '--------------------------' );

    // Go through all the defender's losses and collapse down duplicates
    // Then cycle through and "kill" them
    losses = Array<number>();
    defenderLosses.forEach( fight => {
        if( this._debug ) console.log( fight );
      if( losses[ fight.d ] ) losses[ fight.d ] += fight.k;
      else losses[ fight.d ] = fight.k;
    } );
    if( this._debug ) console.log( losses );
    ret.defender = losses;
    for( let i:number = 0; i < losses.length; i++ ) {
        if( this._debug ) console.log( i );
      this._defender.killUnit( this._defendingArmy.units[ i ].id, losses[ i ] );
    }

    if( this._debug ) console.log( '--------------------------' );

    return ret;
  }

  private prepData( type:string ):JSONObject {
    let ret:JSONObject = {};

    ret.attacker = this._attacker.id;
    ret.attacker_avatar = this._attacker.avatar;
    ret.attacker_name = this._attacker.username;
    ret.defender = this._defender.id;
    ret.defender_avatar = this._defender.avatar;
    ret.defender_name = this._defender.username;
    ret.armies = {};
    ret.armies.attacker = this._attackingArmy.condense();
    ret.armies.defender = this._defendingArmy.condense();
    ret.losses = {};
    ret.type = type;

    return ret;
  }

  private async processRaidLoot( ratio:number ):Promise<JSONObject> {
    this.debug( 'processRaidLoot' );

    let query:string = `SELECT wood, food, gold, metal, stone FROM users_rounds WHERE userid = ? AND roundid = ? LIMIT 1`;
    let loot:RowDataPacket = await dbase.getOne( query, [ this._defender.id, this._attacker.round ] );

    let max = 30;
    let min = 15;
    let data:JSONObject = {};
    
    let wood = Math.floor( ( Math.random() * ( max - min ) + min ) * loot.wood / 100 * ratio );
    let food = Math.floor( ( Math.random() * ( max - min ) + min ) * loot.food / 100 * ratio );
    let gold = Math.floor( ( Math.random() * ( max - min ) + min ) * loot.gold / 100 * ratio );
    let stone = Math.floor( ( Math.random() * ( max - min ) + min ) * loot.stone / 100 * ratio );
    let metal = Math.floor( ( Math.random() * ( max - min ) + min ) * loot.metal / 100  * ratio );

    if( wood > 0 || food > 0 || gold > 0 || metal > 0 || stone > 0 ) {
      this._defender.wood -= wood;
      this._defender.food -= food;
      this._defender.gold -= gold;
      this._defender.stone -= stone;
      this._defender.metal -= metal;
      let success:boolean = await this._defender.commit();
      if( !success ) logger.logError( `Error taking defender's raid losses` );
      
      this._attacker.energySpent += this._energyRaid;
      this._attacker.energy -= this._energyRaid;
      this._attacker.logEnergy( 'raid', this._energyRaid );
      this._attacker.wood += wood;
      this._attacker.gold += gold;
      this._attacker.food += food;
      this._attacker.stone += stone;
      this._attacker.metal += metal;
      success = await this._attacker.commit();
      if( !success ) logger.logError( `Error adding attacker's raid winnings` );

      let result:string = '';			
      if( wood > 0 ) result = wood + " wood";
      if( stone > 0 ) result = ( result != "" ? result + ", " : "" ) + stone + " stone";
      if( metal > 0 ) result = ( result != "" ? result + ", " : "" ) + metal + " metal";
      if( food > 0 ) result = ( result != "" ? result + ", " : "" ) + food + " food";
      if( gold > 0 ) result = ( result != "" ? result + ", " : "" ) + gold + " gold";              

      this._defender.log( 'Raid Losses: ' + result, this._attacker.round );
      this._attacker.log( 'Raid Gains: ' + result, this._attacker.round );
    } else {
      this._defender.log( 'Raid Losses: None', this._attacker.round );
      this._attacker.log( 'Raid Gains: None', this._attacker.round );

      this._attacker.energySpent += this._energyRaid;
      this._attacker.energy -= this._energyRaid;
      await this._attacker.commit();
    }

    let losses:JSONObject = {};
    if( wood ) losses = { wood, ...losses };
    if( food ) losses = { food, ...losses };
    if( gold ) losses = { gold, ...losses };
    if( stone ) losses = { stone, ...losses };
    if( metal ) losses = { metal, ...losses };

    return losses;
  }

  private processCombat():JSONObject {
    this.debug( 'processCombat' );

    let ret:JSONObject = {};
    
    if( this._defendingArmy.units.length === 0 ) return { victory:true };
    
    const attacker:Unit[] = this._attackingArmy.units;
    const defender:Unit[] = this._defendingArmy.units;
    const attackerPower:number = this._attackingArmy.power;
    const defenderPower:number = this._defendingArmy.power;

    let offset:number = 0;
    let fight:JSONObject|null;
    let target:number;
    let log:Array<JSONObject> = new Array<JSONObject>();
    
    if( this._debug ) {
        console.log( this._attackingArmy );
        console.log( this._attackingArmy.power );
        console.log( this._defendingArmy );
        console.log( this._defendingArmy.power );
    }

    while( offset < attacker.length || offset < defender.length ) {      
      if( offset < attacker.length ) {
        target = offset < defender.length ? offset : defender.length - 1;
        fight = attacker[ offset ].fight( defender[ target ], this._defender.defense );
        if( fight ) log.push( { o:'a', d:target, a:offset, ...fight } );
      }

      if( offset < defender.length ) {
        target = offset < attacker.length ? offset : attacker.length - 1;
        fight = defender[ offset ].fight( attacker[ target ] );
        if( fight ) log.push( { o:'d', d:offset, a:target, ...fight } );
      }
        
      offset++;
    }
    
    ret.victory = ( attackerPower - this._attackingArmy.power ) < ( defenderPower - this._defendingArmy.power );
    ret.log = log;
    return ret;
  }

  public async raid():Promise<JSONObject> {
    this.debug( 'raid' );

    this.validate( this._energyRaid );

    this._attacker.log( 'Raided: ' + this._defender.username );
    this._defender.log( 'Raided by: ' + this._attacker.username );

    this._attackingArmy.clear( 1 );
    	
    //Get our power to build the success ratio
    let ratio = this._defendingArmy.power > 0 ? ( this._attackingArmy.units[ 0 ].power * this._attackingArmy.units[ 0 ].quantity ) / this._defendingArmy.power * 100 : 0;
    let roll = Math.floor( ( Math.random() * 100 ) + 1 );
    let data:JSONObject = this.prepData( 'raid' );
    
    //We were caught!
    if( roll <= ratio ) {
      let log:Array<JSONObject> = new Array<JSONObject>();

      for( let i = 0; i < this._defendingArmy.units.length; i++ ) {
        let fight = this._defendingArmy.units[ i ].fight( this._attackingArmy.units[ 0 ] );
        if( fight ) log.push( { o:'d', d:i, a:0, ...fight } );			

        if( this._attackingArmy.units[ 0 ].quantity === 0 ) break;				
      }

      data.victory = false;
      data.log = log;
      data.losses.units = await this.processUnitLosses( log );

      this._attacker.energySpent += this._energyRaid;
      this._attacker.energy -= this._energyRaid;
      this._attacker.logEnergy( 'raid', this._energyRaid );
      await this._attacker.commit();

      this._attacker.log( 'Raid Failed Lost: ' + JSON.stringify( data.losses.units ) );
      this._defender.log( 'Raid Failed Killed: ' + JSON.stringify( data.losses.units ) );
    } else {
	    // Turn ratio into percentage
		ratio /= 100;
  
      data.losses.resources = await this.processRaidLoot( ratio );

      this._attacker.log( 'Gained: ' + JSON.stringify( data.losses.resources ) );
      this._defender.log( 'Lost: ' + JSON.stringify( data.losses.resources ) );

      data.victory = true;
	}
        
    const server:string = await this._getAsync( 'USER-' + this._defender.id );
    if( this._debug ) console.log( 'SERVER: ' + server );

		//this.logenergy( "raid", energy );
        //return { success:true, energy:energy };*/
        
    this._attacker.calculatePower( this._attacker.round );
    this._defender.calculatePower( this._attacker.round );

    return await this.saveFight( data );
  }

  public async attack():Promise<JSONObject> {
    this.debug( 'attack' );

    this.validate( this._energyAttack );

    this._attacker.log( 'Attacked: ' + this._defender.username );
    this._defender.log( 'Attacked by: ' + this._attacker.username );

    let data:JSONObject = this.prepData( 'fight' );
    let fight = await this.processCombat();

    this._attacker.energySpent += this._energyAttack;
    this._attacker.energy -= this._energyAttack;
    this._attacker.logEnergy( 'attack', this._energyAttack );    

    data.losses = {};
    data.log = fight.log;
    data.losses.units = await this.processUnitLosses( fight.log );
    data.victory = fight.victory;
    if( fight.victory ) {
      const landSeed:number = Math.floor( this._defender.land * .02 );
      let gain = Math.floor( ( Math.random() * landSeed / 2 ) + ( landSeed / 2 ) );      
      let result:JSONObject = await this._defender.takeLand( gain );
      
      this._attacker.land += gain;
      this._attacker.landFree += gain;
      await this._attacker.commit();

      data.losses.buildings = result.destroyed;
      data.losses.land = result.land;

      this._attacker.log( 'Attack Success: gained ' + gain + ' acres' );
      this._defender.log( 'Attack Lost: lost ' + gain + ' acres' );
    } else await this._attacker.commit();

    const server:string = await this._getAsync( 'USER-' + this._defender.id );
    if( this._debug ) console.log( 'SERVER: ' + server );
    if( server ) {
        const packet:JSONObject = {
            command: 'USER_ATTACKED',
            defender: this._defender.id,
        }
        this._redis.publish( server, JSON.stringify( packet ) );
    }

    this._attacker.calculatePower( this._attacker.round );
    this._defender.calculatePower( this._attacker.round );

    return await this.saveFight( data );

    
    // We're good, let's do this
    /*await this.processCombat();
    if( this.victory ) {
        let defeat = await this.processCombatDefeat( this.defender );
        console.log( defeat );
    }

    //Create the connection
    const connection = await this.database.beginTransaction();

    //Outcome for building
    let outcome = "";		

    try {
      //Record our unit losses
      let attackerLosses = await this.processUnitLosses( this.attacker, connection );
      if( attackerLosses.error ) { await this.database.rollback( connection ); Logger.logError( "Error Attacking: " + attackerLosses.error ); return this.dispatchError( "Error attacking" ); }
      
      let defenderLosses = await this.processUnitLosses( this.ddefender, connection );
      if( defenderLosses.error ) { await this.database.rollback( connection ); Logger.logError( "Error Attacking: " + defenderLosses.error ); return this.dispatchError( "Error attacking" ); }					
            
      //Build up wording
      let losses = attackerLosses && attackerLosses.lost ? this.username + " lost " + attackerLosses.lost + "\n" : "";
      losses += defenderLosses && defenderLosses.lost ? defender.username + " lost " + defenderLosses.lost + "\n" : "";
      
      if( result.victory ) {
        let query = "UPDATE users_rounds SET land = land + " + defeat.gain + ", land_free = land_free + " + defeat.gain + ", energy = energy - " + energy + ", energy_spent = energy_spent + " + energy + " WHERE userid = " + this.id + " AND roundid = " + this.round + " AND energy >= " + energy;				
        let success = await connection.query( query );
        if( !success || success[ 0 ].affectedRows != 1 ) {
          await this.database.rollback( connection );
          Logger.logError( "Error Attacking: " + query );
          return this.dispatchError( "Error attacking" );
        }
                
        let totalBuildings = await this.database.getOne( "SELECT SUM(quantity) AS total FROM users_rounds_buildings WHERE userid = " + defender.id + " AND roundid = " + this.round );				
        if( totalBuildings.total  ) totalBuildings = totalBuildings.total;
        else totalBuildings = 0;
                
        query = "UPDATE users_rounds SET land = land - " + ( defeat.gain + defeat.destroy ) + ", land_free = land - " + totalBuildings + " WHERE userid = " + defender.id + " AND roundid = " + this.round;
        success = await connection.query( query );
        if( !success || success[ 0 ].affectedRows != 1 ) {
          await this.database.rollback( connection );
          Logger.logerror( "Error Attacking: " + query );
          return this.dispatchError( "Error attacking" );
        }
        
        if( defeat.gain ) {
          outcome = "You were victorious!\n\nYou gained " + defeat.gain + " " + ( defeat.gain != 1 ? "acres" : "acre" ) + ( defeat.destroy ? " and destroyed " + defeat.destroy + " " + ( defeat.destroy == 1 ? "acre" : "acres" ) : "" );
          let buildingLosses = await this.processBuildingLosses( defender, defeat, connection );					
          if( buildingLosses.error ) {
            await this.database.rollback( connection );
            Logger.logError( "Error Attacking: " + buildingLosses.error );
            return this.dispatchError( "Error attacking" );
          }
        }
        else outcome = "You were victorious!\n\nBut you gained no land";							
      } else {
        outcome = "You were defeated!";
        
        let query = "UPDATE users_rounds SET energy_spent = energy_spent + " + energy + ", energy = energy - " + energy + " WHERE userid = " + this.id + " AND roundid = " + this.round + " AND energy >= 1";
        let success = await connection.query( query );
        if( !success || success[ 0 ].affectedRows != 1 ) {
          await this.database.rollback( connection );
          Logger.logError( "Error Attacking: " + query );
          return this.dispatchError( "Error attacking" );
        }
      }
      
      let query = "INSERT INTO events SET userid = " + defender.id + ", roundid = " + this.round + ", type = 'attack', event = '" + this.username + " attacked you.  You lost!', unread = 1, deleted = 0, time = UNIX_TIMESTAMP()";
      let result = await connection.query( query );
      if( !result || result[ 0 ].affectedRows != 1 ) {
        Logger.logError( "Error Recording Attack Event: " + query );
      }
      await this.database.commit( connection );

      outcome += ( losses != "" ? "\n\n" + losses : "" );					
      
      const log = Buffer.from( combat.log ).toString( "base64" );
      outcome = Buffer.from( outcome ).toString( "base64" );
      this.saveFight( defender, "attack", true, log, outcome );					
      
      this.calculatePower( this.id, this.round );
      this.calculatePower( defender.id, this.round );

      this.updateDeltas();
      this.updateDeltas( defender.id );
      this.update();
      
      this.logenergy( "attack", energy );
      return { success:true, energy:energy };
    } catch( err ) {
      await this.database.rollback( connection );
      Logger.logError( err );
      return this.dispatchError( "Error processing attack" );
    }*/
    return {};
  }

  private async saveFight( data:JSONObject ):Promise<JSONObject> {
    this.debug( 'saveFight' );

    if( this._debug ) console.log( JSON.stringify( data ) );

    const guid:String = UUID();
    const query:string = 'INSERT INTO fights ( guid, type, attacker, attacking_army, defender, defending_army, roundid, winner, combat, result, time, attacker_view, defender_view ) VALUES ( ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UNIX_TIMESTAMP(), 1, 1 )';
    const result:RowDataPacket = await dbase.query( query, [ guid, data.type, data.attacker, JSON.stringify( data.armies.attacker ), data.defender, JSON.stringify( data.armies.defender ), this._attacker.round, data.victory ? data.attacker : data.defender, JSON.stringify( data.log ), JSON.stringify( data.losses ) ] );

    if( result[ 0 ].affectedRows !== 1 ) logger.logError( 'Error: Recording Fight' );

    return {
      guid,
      type: data.type,
      attacker: data.attacker,
      attacker_avatar: data.attacker_avatar,
      attacker_name: data.attacker_name,
      defender: data.defender,
      defender_avatar: data.defender_avatar,
      defender_name: data.defender_name,
      attacking_army: data.armies.attacker,
      defending_army: data.armies.defender,
      victory: data.victory,
      combat: data.log,
      result: data.losses,
    };
  }

  private error( type:string, data:string ):JSONObject {
    return { type, data }
  }

  private debug( msg:string ):void {
    if( this._debug )
      logger.logServer( msg );
  }
}