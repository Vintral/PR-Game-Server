import { RowDataPacket } from 'mysql2/promise';
import * as WebSocket from 'websocket';
import { JSONObject, Resources, Incomes, Upkeeps } from '../interfaces';
import dbase from '../database';
import logger from '../logger';
import { PRECISION, LAND_PRECISION } from '../constants';
import chalk from 'chalk';

export default class User {
  //==============================//
  //  Properties                  //
  //==============================//
  private _debug:boolean = false;
  private _id: number;
  private _interval:number = 1;

  private _connection:any = '';
  private _token:string = '';
  private _ip:string = '';

  private _round: number = -1;
  private _username: string = '';
  private _email: string = '';
  private _avatar: string = '';
  private _sex: string = '';

  private _gems: number = 0;

  private _energy:number = 0;
  private _energySpent:number = 0;

  private _resources: Resources = { gold:0, wood: 0, food: 0, metal: 0, stone: 0 };
  private _incomes: Incomes = { gold:0, wood: 0, food: 0, metal: 0, stone: 0 };
  private _upkeeps: Upkeeps = { gold:0, wood: 0, food: 0, metal: 0, stone: 0 };

  private _land:number = 0;
  private _landFree:number = 0;
  
  private _recruit:number = 0;
  private _build:number = 0;
  private _defense:number = 0;

  private _population:number = 0;
  private _populationMax:number = 0;

  private _banned: boolean = false;
  private _bannedReason: string = '';
  private _bannedUntil: number = -1;

  private _buildings:JSONObject = {};
  private _units:JSONObject = {};

  private _power:number = 0;

  private _vaultMax:number = 0;

  public _dirty:any[] = [];
  //private _dirty:JSONObject[] = [];
  
  private _minuteInterval:any = -1;
  private _5minuteInterval:any = -1;

  private _error: string = '';
  private _precision:number = 100;

  private _redis:any = '';

  //==============================//
  //  Accessors                   //
  //==============================//
  //set playing( value:boolean ) { this._playing = value; }

  get id(): number { return this._id; }

  set redis( value:any ) {
    this._redis = value;
  }

  set connection( value:WebSocket.connection ) { 
    this._connection = value;
    this.startTimers();
  }

  set token( value:string ) {
    this._token = value;
  }

  get sex(): string { return this._sex; }

  get username(): string { return this._username; }

  get power(): number { return this._power; }

  get round(): number { return this._round; }
  set round( value:number ) { this._round = value; }

  get avatar(): string { return this._avatar; }
  set avatar( value:string ) { this._avatar = value; }

  get defense(): number { return this._defense; }

  get buildPower(): number { return this._build; }
  get recruitPower(): number {    
    return this._recruit;
  }

  get gems():number { return this._gems; }
  set gems( value:number ) {
    this.storeDirty( 'gems', value - this._gems );
    this._gems = value;
  }

  get energy():number { return this._energy; }
  set energy( value:number ) {
    this.storeDirty( 'energy', value - this._energy );
    this._energy = value; 
  }

  get energySpent():number { return this._energySpent; }
  set energySpent( value:number ) {
    this.storeDirty( 'energy_spent', value - this._energySpent );
    this._energySpent = value;
  }

  get population():number { return this._population; }
  set population( value:number ) {
    this.storeDirty( 'population', value - this._population );
    this._population = value; 
  }

  get populationMax():number { return this._populationMax; }
  set populationMax( value:number ) {
    this.storeDirty( 'population_max', value - this._populationMax );
    this._populationMax = value; 
  }

  get metal():number { return this._resources.metal; }
  set metal( value:number ) { 
    this.storeDirty( 'metal', value - this._resources.metal );
    this._resources.metal = value;
  }

  get wood():number { return this._resources.wood; }
  set wood( value:number ) { 
    this.storeDirty( 'wood', value - this._resources.wood );
    this._resources.wood = value;
  }

  get stone():number { return this._resources.stone; }
  set stone( value:number ) { 
    this.storeDirty( 'stone', value - this._resources.stone );
    this._resources.stone = value;
  }

  get food():number { return this._resources.food; }
  set food( value:number ) {
    this.storeDirty( 'food', value - this._resources.food );
    this._resources.food = value;
  }

  get gold():number { return this._resources.gold; }
  set gold( value:number ) {    
    this.storeDirty( 'gold', value - this._resources.gold );
    this._resources.gold = value;
  }

  get land():number { return Math.floor( this._land / LAND_PRECISION ); }
  set land( value:number ) {   
    console.log( 'SET LAND: ' + value ); 
    value = ( value * LAND_PRECISION ) + ( this._land % LAND_PRECISION );
    value = Math.floor( value );
    this.storeDirty( 'land', Math.floor( value - this._land ) );
    this._land = value;
  }

  get landFree():number { return Math.floor( this._landFree / LAND_PRECISION ); }
  set landFree( value:number ) {    
    value = ( value * LAND_PRECISION ) + ( this._landFree % LAND_PRECISION );
    value = Math.floor( value );
    if( value % LAND_PRECISION === 0 ) value += this._land % LAND_PRECISION;    
    this.storeDirty( 'land_free', value - this._landFree );
    this._landFree = value;
  }

  get resources():Resources { return this._resources; }
  get incomes():Incomes { return this._incomes; }
  get upkeeps():Upkeeps { return this._upkeeps; }
  get units():JSONObject { return this._units; }
  get buildings():JSONObject { return this._buildings; }

  //==============================//
  //  Constructor                 //
  //==============================//
  constructor( id:number ) {
    this._id = id;

    this.onMinuteTick = this.onMinuteTick.bind( this );
    this.onFiveMinuteTick = this.onFiveMinuteTick.bind( this );
  }

  //==============================//
  //  Methods                     //
  //==============================//
  public async load( round:number = -1, skipUnits:boolean = false, skipBuildings:boolean = false ): Promise<boolean> {
    let data = await dbase.getOne( `SELECT username, email, current_round, avatar, gems, sex, users_bots.type AS bot, banned, banned_reason, banned_until, vault_size FROM users LEFT JOIN users_bots ON users_bots.userid = users.id WHERE users.id = ? LIMIT 1`, [ this._id ] );    
    if (!data) logger.logError( 'User Not Found: ' + this._id );
    else {
      this._username = data.username;
      this._email = data.email;
      this._round = data.current_round;
      this._avatar = data.avatar;
      this._gems = data.gems;
      this._sex = data.sex;

      this._vaultMax = data.vault_size;
      
      this._banned = data.banned;
      this._bannedReason = data.banned_reason;
      this._bannedUntil = data.banned_until;
    }

    if( round !== -1 ) this._round = round;
    if( this._round != 0 ) await this.loadRoundData( skipUnits, skipBuildings );
    return true;
  }

  public async recordIP( ip:string ):Promise<void> {
    this.debug( 'recordIP: ' + ip );
    
    this._ip = ip;
    this.log( 'Logged in: ' + ip, 0 );

    const queries:JSONObject = {
      update: `UPDATE users_ips SET date = UNIX_TIMESTAMP() WHERE userid = ? AND ip = ?`,
      insert: `INSERT INTO users_ips ( userid, ip, date ) VALUES ( ?, ?, UNIX_TIMESTAMP() )`
    }

    let result:RowDataPacket = await dbase.query( queries.update, [ this._id, ip ] );
    if( result[ 0 ].affectedRows === 1 ) return;

    result = await dbase.query( queries.insert, [ this._id, ip ] );
    if( result[ 0 ].affectedRows !== 1 ) logger.logError( 'Error recording IP: ' + ip + ' for ' + this._id );
  }

  public async checkForDupes():Promise<boolean> {
    this.debug( 'checkForDupes' );

    const queries:JSONObject = {
      token: `SELECT userid, username FROM users_push_tokens INNER JOIN users ON users.id = userid WHERE token = ? AND userid <> ?`,
      ip: `SELECT userid FROM users_ips WHERE ip = ? AND userid <> ?`,
      update: `UPDATE users_dupes SET time = UNIX_TIMESTAMP() WHERE userid = ? AND dupe = ? AND type = ?`,
      insert: `INSERT INTO users_dupes ( userid, dupe, type, viewed, time ) VALUES ( ?, ?, ?, 0, UNIX_TIMESTAMP() )`,
      banned: `SELECT username, banned FROM users WHERE id = ?`,
      ban: `UPDATE users SET banned_until = -1, banned_reason = ?, banned = 1 WHERE id = ?`      
    }

    let results:RowDataPacket[] = await dbase.get( queries.token, [ this._token, this._id ] );    
    for( let i:number = 0; i < results.length; i++ ) {      
      this.debug( 'Marking Self' );
      let result:RowDataPacket = await dbase.query( queries.update, [ this._id, results[ i ].userid, 1 ] );
      if( result[ 0 ].affectedRows !== 1 ) {
        result = await dbase.query( queries.insert, [ this._id, results[ i ].userid, 1 ] );
        this.log( 'Dupe of: ' + results[ i ].username, 0 );
      }

      this.debug( 'Marking Other' );
      result = await dbase.query( queries.update, [ results[ i ].userid, this._id, 1 ] );
      if( result[ 0 ].affectedRows !== 1 ) {
        result = await dbase.query( queries.insert, [ results[ i ].userid, this._id, 1 ] );

        // Log being marked a dupe in the other user
        let query:string = `INSERT INTO users_log SET userid = ?, roundid = ?, action = ?, time = UNIX_TIMESTAMP()`;        
        await dbase.query( query, [ results[ i ].userid, 0, 'Dupe of ' + this._username ] );
      }

      this.debug( 'Checking For ban' );
      result = await dbase.getOne( queries.banned, [ results[ i ].userid ] );      
      if( result && result.banned ) {
        await dbase.query( queries.ban, [ 'Dupe of ' + result.username, this._id ] );
        return false;
      }
    }

    /*results = await dbase.get( queries.ip, [ this._ip, this._id ] );
    console.log( results );
    for( let i:number = 0; i < results.length; i++ ) {
      let result:RowDataPacket = await dbase.query( queries.update, [ this._id, results[ i ].userid, 2 ] );
      if( result[ 0 ].affectedRows !== 1 ) {
        result = await dbase.query( queries.insert, [ this._id, results[ i ].userid, 2 ] );
      }
    }*/

    return true;
  }

  public async updateDeltas( round:number = 0 ) {
    if( !round ) round = this.round;

    this.debug( 'updateDeltas: ' + round );

    const queries = {
        user: 'SELECT land, population FROM users_rounds WHERE userid = ? AND roundid = ? LIMIT 1',
        buildings: 'SELECT buildings.field, buildings.bonus, quantity FROM users_rounds_buildings INNER JOIN buildings ON buildings.id = users_rounds_buildings.buildingid WHERE userid = ? AND roundid = ?',
        units: 'SELECT upkeep_gold AS gold, upkeep_food AS food, quantity FROM users_rounds_units INNER JOIN units ON units.id = unitid WHERE userid = ? AND roundid = ?',
    }
    
    let data:RowDataPacket = await dbase.getOne( queries.user, [ this.id, round ] );
    if( data ) {
        const land:number = data.land;
        const population:number = data.population;
        
        const changes:JSONObject = {};
        changes.food = { income:0, upkeep:0 };
        changes.mana = { income:0, upkeep:0 };
        changes.faith = { income:0, upkeep:0 };
        changes.wood = { income:0, upkeep:0 };
        changes.stone = { income:0, upkeep:0 };
        changes.metal = { income:0, upkeep:0 };
        changes.gold = { income:0, upkeep:0 };
        changes.recruit = { income: 10 };
        changes.build = { income: 10 };
        changes.population = { income: 10 };
        changes.defense = { income:0 };

        changes.gold.income = Math.floor( population ) * 1;
        changes.food.upkeep = Math.floor( population ) * 1;
        
        const buildings = await dbase.get( queries.buildings, [ this.id, round ] );        
        if( buildings ) {
            for( var b in buildings ) {
                changes[ buildings[ b ].field ].income += buildings[ b ].quantity * buildings[ b ].bonus;
            }
        }
        
        const units = await dbase.get( queries.units, [ this.id, round ] );
        if( units ) {
            for( var u in units ) {
                changes.food.upkeep += 1 * units[ u ].quantity * units[ u ].food;
                changes.gold.upkeep += 1 * units[ u ].quantity * units[ u ].gold;					
            }
        }        

        this._incomes.gold = changes.gold.income;
        this._upkeeps.gold = changes.gold.upkeep;
        this._incomes.wood = changes.wood.income;
        this._upkeeps.wood = changes.wood.upkeep;
        this._incomes.food = changes.food.income;
        this._upkeeps.food = changes.food.upkeep;
        this._incomes.stone = changes.stone.income;
        this._upkeeps.stone = changes.stone.upkeep;
        this._incomes.metal = changes.metal.income;
        this._upkeeps.metal = changes.metal.upkeep;
        this._populationMax = changes.population.income;
        this._build = changes.build.income;
        this._recruit = changes.recruit.income;
        this._defense = changes.defense.income;
        
        const update:string = 'UPDATE users_rounds SET defense = ?, population_max = ?, recruit = ?, build = ?, gold_income = ?, gold_upkeep = ?, metal_income = ?, metal_upkeep = ?, food_income = ?, food_upkeep = ?, mana_income = ?, mana_upkeep = ?, faith_income = ?, faith_upkeep = ?, wood_income = ?, wood_upkeep = ?, stone_income = ?, stone_upkeep = ? WHERE userid = ? AND roundid = ?';
        const result:RowDataPacket = await dbase.query( update, [
            ( changes.defense.income / land ) * 100,
            changes.population.income,
            changes.recruit.income,
            changes.build.income,
            changes.gold.income,            
            changes.gold.upkeep,
            changes.metal.income,
            changes.metal.upkeep,
            changes.food.income,
            changes.food.upkeep,
            changes.mana.income,
            changes.mana.upkeep,
            changes.faith.income,
            changes.faith.upkeep,
            changes.wood.income,
            changes.wood.upkeep,
            changes.stone.income,
            changes.stone.upkeep,
            this.id,
            round
        ] );        
        if( result[ 0 ].affectedRows === 1 ) {
            /*await connection.commit( connection );					

            if( user == this.id ) {
                this.emit( "UPDATED" );
                this.update();
            }*/
        } else {
            //await dbase.rollback( connection );                        
            logger.logError( "Error Updating Deltas: " + update );									
            //this.dispatch( "ERROR", "Error updating tick values" );
        }
    }
}

public stop():void {
    this.debug( 'stop' );

    clearInterval( this._minuteInterval );
    clearInterval( this._5minuteInterval );
}

  public async loadRoundData( skipUnits:boolean = false, skipBuildings:boolean = false ): Promise<boolean> {
    this.debug( 'loadRoundData: ' + this._round );

    const queries = {
      info: `SELECT * FROM users_rounds WHERE userid = ? AND roundid = ?`
    }

    let data:RowDataPacket = await dbase.getOne( queries.info, [ this._id, this._round ] );
    if( !data ) throw "AHHHH";

    this._land = +data.land;
    this._landFree = +data.land_free;
    
    if( this.land * LAND_PRECISION % LAND_PRECISION !== this.landFree * LAND_PRECISION % LAND_PRECISION ) {
      console.log( '=======================================' );
      console.log( '=======================================' );
      console.log( '=======================================' );
      console.log( this.land + ' ---- ' + this.landFree );
      console.log( this.land * LAND_PRECISION % LAND_PRECISION );
      console.log( this.landFree * LAND_PRECISION % LAND_PRECISION );
      console.log( '=======================================' );
      console.log( '=======================================' );
      console.log( '=======================================' );

      process.exit( 1 );
    }

    this._population = +data.population;
    this._populationMax = +data.population_max;

    this._power = +data.power;

    this._energy = +data.energy;

    this._build = +data.build;
    this._recruit = +data.recruit;
    this._defense = +data.defense;

    this._resources.food = +data.food;
    this._incomes.food = +data.food_income;
    this._upkeeps.food = +data.food_upkeep;

    this._resources.gold = +data.gold;
    this._incomes.gold = +data.gold_income;
    this._upkeeps.gold = +data.gold_upkeep;

    this._resources.wood = +data.wood;
    this._incomes.wood = +data.wood_income;
    this._upkeeps.wood = +data.wood_income;

    this._resources.stone = +data.stone;
    this._incomes.stone = +data.stone_income;
    this._upkeeps.stone = +data.stone_upkeep;

    this._resources.metal = +data.metal;
    this._incomes.metal = +data.metal_income;
    this._upkeeps.metal = +data.metal_upkeep;

    if( !skipBuildings ) await this.loadBuildings();
    if( !skipUnits) await this.loadUnits();

    return true;
  }

  public async dumpEnergy():Promise<void> {
    let result:RowDataPacket = await dbase.getOne( 'SELECT energy FROM users_rounds WHERE userid = ? AND roundid = ?', [ this.id, this.round ] );
    console.log( 'ENERGY CHECK: ' + result.energy + ' --- ' + this.energy );
  }

  public async loadBuildings( round?:number ) {
    this.debug( 'loadBuildings' );

    if( !round ) round = this.round;

    const query:string = `SELECT * FROM users_rounds_buildings WHERE userid = ? AND roundid = ?`;
    const result:RowDataPacket[] = await dbase.get( query, [ this.id, round ] );    
    const buildings:JSONObject = {};
    result.forEach( row => {
        buildings[ row.buildingid ] = row.quantity;
    } );
    this._buildings = buildings;
  }

  public async loadUnits( round?:number ) {
    this.debug( 'loadUnits' );

    if( !round ) round = this.round;

    const query:string = `SELECT * FROM users_rounds_units WHERE userid = ? AND roundid = ?`;
    const result:RowDataPacket[] = await dbase.get( query, [ this.id, round ] );
    const units:JSONObject = {};
    result.forEach( row => {
        units[ row.unitid ] = row.quantity;
    } );
    this._units = units;
  }

  public async takeLand( amount:number ):Promise<JSONObject> {
    this.debug( 'takeLand: ' + amount, true );    
    
    let result:RowDataPacket = await dbase.getOne( 'SELECT land, land_free FROM users_rounds WHERE userid = ? AND roundid = ?', [ this.id, this.round ] );
    console.log( result );    

    console.log( 'CURRENT' );
    console.log( this.land + ' --- ' + this.landFree );

    if( amount > this.land ) return {};
    if( amount < this.landFree ) {
      this.land -= amount;
      this.landFree -= amount;

      await this.commit();

      return { land: amount };
    } else {
      const overrun:number = Math.ceil( amount - this.landFree );
      this.debug( 'Need to Destroy: ' + overrun + ' buildings', true );      
      
      let roll:number = 0;
      let totalBuildings:number = 0;
      let keys:string[] = Object.keys( this._buildings );
      let destroyed:JSONObject = {};

      keys.forEach( building => {
        totalBuildings += this._buildings[ building ];
      } )

      for( let i:number = 0; i < overrun; i++ ) {
        roll = Math.floor( Math.random() * totalBuildings );
        
        for( let n:number = 0; n < keys.length; n++ ) {
          roll -= this._buildings[ keys[ n ] ];
          if( roll < 0 ) {
            if( destroyed[ keys[ n ] ] ) destroyed[ keys[ n ] ]++;
            else destroyed[ keys[ n ] ] = 1;

            break;
          }
        }
        totalBuildings--;
      }
      
      keys = Object.keys( destroyed );
      keys.forEach( building => this.takeBuilding( building, destroyed[ building ] ) );

      console.log( amount );
      console.log( destroyed );

      console.log( '---------------------' );
      console.log( this.land );
      console.log( amount );      
      this.land = this.land - amount;
      console.log( this.land );
      console.log( '---------------------' );
      console.log( 'LAND FREE BEFORE: ' + this.landFree );
      console.log( amount );
      console.log( overrun );
      console.log( ( amount - overrun ) );      
      this.landFree -= ( amount - overrun );
      console.log( 'LAND FREE AFTER: ' + this.landFree );

      console.log( 'AFTER' );
      console.log( this.land + ' --- ' + this.landFree );

      await this.commit();

      //process.exit( 1 );

      return { land: amount, destroyed }
    }
  }

  public async killUnit( type:number, amount:number ):Promise<boolean> {
      this.debug( 'killUnit: ' + type + ' - ' + amount );

      const query:string = `UPDATE users_rounds_units SET quantity = quantity - ? WHERE userid = ? AND roundid = ? AND unitid = ? AND quantity > ?`;
      const result:RowDataPacket[] = await dbase.query( query, [ amount, this.id, this.round, type, amount ] );
      if( result[ 0 ].affectedRows !== 1 ) await dbase.query( `DELETE FROM users_rounds_units WHERE userid = ? AND roundid = ? AND unitid = ?`, [ this.id, this.round, type ] );

      return true;
  }

  private async onMinuteTick():Promise<void> {
      this.debug( 'onMinuteTick', true );

      this._interval++;
      const flag:boolean = this._interval % 5 === 0 ? true : false;
      await this.load( this._round, !flag, !flag );

      console.log( flag ? this.trim() : this.trimLight() );

      const packet:JSONObject = {
        type: 'PLAYER_INFO',
        data: {
            user: flag ? this.trim() : this.trimLight(),
        }
      }
      try {
        this._connection.sendUTF( JSON.stringify( packet ) );
      } catch( err ) {
          console.log( chalk.red( 'USER ERROR 1' ) );
          console.log( err );
      }
  }

  private async onFiveMinuteTick():Promise<void> {
    this.debug( 'onMinuteTick', true );

    await this.load( this._round );

    const packet:JSONObject = {
      type: 'PLAYER_INFO',
      data: {
          user: this.trim(),
      }
    }

    try {
        this._connection.sendUTF( JSON.stringify( packet ) );
    } catch( err ) {
        console.log( chalk.red( 'USER ERROR 2' ) );
        console.log( err );
    }
}

public async update():Promise<void> {
  this.debug( 'UPDATE' );
  this.onFiveMinuteTick();
}

  private async startTimers() {
      this.debug( 'startTimers' );
      
      this._minuteInterval = setInterval( this.onMinuteTick, 60 * 1000 );
      //this._5minuteInterval = setInterval( this.onFiveMinuteTick, 300 * 1000 );
  }

  public async calculatePower( round:number ) {
    this.debug( 'calculatePower' );
		
	  let power:number = 0;
    
    const queries = {
      army:`SELECT quantity, attack, defense, ( quantity * ( attack + defense ) ) AS total FROM users_rounds_units INNER JOIN units ON units.id = unitid WHERE userid = ? AND roundid = ?`,
      land:`SELECT land FROM users_rounds WHERE userid = ? AND roundid = ?`,
      update:`UPDATE users_rounds SET power = ? WHERE userid = ? AND roundid = ? LIMIT 1`
    }
		
    const army = await dbase.get( queries.army, [ this.id, round ] );
    if( army && army.length >= 1 ) {			
        for( var i in army ) 
            power += parseFloat( army[ i ].total );								
    }			
            
    const landResult = await dbase.getOne( queries.land, [ this.id, round ] );
    if( landResult ) {
        power += landResult.land * 5 / LAND_PRECISION;
    }

    this._power = Math.ceil( power );    
    if( this._power > 1000000 ) {
        console.log( 'POWER: ' + power );
        console.log( landResult.land * 5 / LAND_PRECISION );
        process.exit( 1 );
    }

    let result = await dbase.query( queries.update, [ this._power, this.id, round ] );    

    if( this._redis ) {
      let packet:JSONObject = {};
      packet.userid = this._id;
      packet.username = this._username;
      packet.roundid = this._round;
      packet.power = this._power;
      packet.from = 'User Model';

      this._redis.publish( 'SET_POWER', JSON.stringify( packet ) );
    }        
  }  

  public async recruit( unit:string, quantity:number ):Promise<boolean> {
      this.debug( 'recruit: ' + unit + ' - ' + quantity );

      const queries = {
        update: `UPDATE users_rounds_units SET quantity = quantity + ? WHERE userid = ? AND roundid = ? AND unitid = ?`,
        insert: `INSERT INTO users_rounds_units SET quantity = ?, userid = ?, roundid = ?, unitid = ?`
      }
  
      let result:RowDataPacket = await dbase.query( queries.update, [ quantity, this.id, this.round, unit ] );
      if( result[ 0 ].affectedRows !== 1 ) {
        result = await dbase.query( queries.insert, [ quantity, this.id, this.round, unit ] );
        if( result[ 0 ].affectedRows !== 1 ) return false;
      }
  
      if( this._units[ unit ] ) this._units[ unit ] += quantity;
      else this._units[ unit ] = quantity;

      await this.updateDeltas();

      return true;
  }

  public async fireUnit( unit:string, quantity:number ):Promise<boolean> {
    this.debug( 'fireUnit: ' + unit + ' - ' + quantity );

    const queries:JSONObject = {
      retrieve: `SELECT id FROM units WHERE type = ?`,
      update: `UPDATE users_rounds_units SET quantity = quantity - ? WHERE userid = ? AND roundid = ? AND unitid = ?`,
      delete: `DELETE FROM users_rounds_units WHERE quantity <= 0`
    }    

    let result:RowDataPacket = await dbase.getOne( queries.retrieve, [ unit ] );
    let unitid:number = result.id;

    result = await dbase.query( queries.update, [ quantity, this.id, this.round, unitid ] );
    await dbase.query( queries.delete );

    this._units[ unitid ] -= quantity;
    if( this._units[ unitid ] <= 0 ) delete this._units[ unitid ];
    
    await this.updateDeltas();

    return result[ 0 ].affectedRows === 1;
  }

  public async build( building:string, quantity:number ):Promise<boolean> {
    this.debug( 'build: ' + building + ' - ' + quantity );
    return await this.updateBuilding( building, quantity );
  }

  private async takeBuilding( type:string, amount:number ):Promise<boolean> {
    this.debug( 'takeBuilding: ' + type + ' - ' + amount );
    return await this.updateBuilding( type, amount );    
  }

  public async destroyBuilding( building:string, quantity:number ):Promise<boolean> {
    this.debug( 'destroyBuilding: ' + building + ' - ' + quantity, true );
    return await this.updateBuilding( building, -quantity );
  }

  private async updateBuilding( building:string, quantity:number ):Promise<boolean> {
    if( quantity > 0 ) {
      const queries = {
        update: `UPDATE users_rounds_buildings SET quantity = quantity + ? WHERE userid = ? AND roundid = ? AND buildingid = ?`,
        insert: `INSERT INTO users_rounds_buildings SET quantity = ?, userid = ?, roundid = ?, buildingid = ?`
      }
  
      let result:RowDataPacket = await dbase.query( queries.update, [ quantity, this.id, this.round, building ] );
      if( result[ 0 ].affectedRows !== 1 ) {
        result = await dbase.query( queries.insert, [ quantity, this.id, this.round, building ] );
        if( result[ 0 ].affectedRows !== 1 ) return false;
      }        
    } else {
      const query:string = `UPDATE users_rounds_buildings SET quantity = quantity + ? WHERE userid = ? AND roundid = ? AND buildingid = ? AND quantity > ?`;
      let result:RowDataPacket[] = await dbase.query( query, [ quantity, this.id, this.round, building, quantity ] );
      
      if( result[ 0 ].affectedRows !== 1 ) {
        result = await dbase.query( `DELETE FROM users_rounds_buildings WHERE userid = ? AND roundid = ? AND buildingid = ?`, [ this.id, this.round, quantity ] );
        if( result[ 0 ].affectedRows !== 1 ) return false;
      }
    }

    if( this._buildings[ building ] ) this._buildings[ building ] += quantity;
    else this._buildings[ building ] = quantity;

    if( this._buildings[ building ] <= 0 ) delete this._buildings[ building ];

    await this.updateDeltas();

    return true;
  }

  public async canAddItem():Promise<boolean> {
      this.debug( 'canAddItem' );

      const query:string = `SELECT COUNT(id) AS items FROM users_vault WHERE userid = ?`;
      const result:RowDataPacket = await dbase.getOne( query, [ this.id ] );
      return result.items < this._vaultMax;
  }  

  public async updateGems( amount:number ):Promise<boolean> {
      this.debug( 'updateGems: ' + amount );

      let result:RowDataPacket;
      if( amount > 0 ) {
        const query:string = `UPDATE users SET gems = gems + ? WHERE id = ?`;
        result = await dbase.query( query, [ amount, this.id ] );
      } else {
        const query:string = `UPDATE users SET gems = gems + ? WHERE gems >= ? AND id = ?`;
        result = await dbase.query( query, [ amount, -amount, this.id ] );
      }
      return result[ 0 ].affectedRows === 1;
  }

  public async addItem( item:number, quantity:number = 1 ):Promise<boolean> {
    this.debug( 'addItem: ' + item );

    const queries:JSONObject = {
      insert: `INSERT INTO users_vault ( userid, itemid, quantity ) VALUES ( ?, ?, ?)`,
      update: `UPDATE users_vault SET quantity = quantity + ? WHERE userid = ? AND itemid = ?`
    }

    let result:RowDataPacket = await dbase.query( queries.update, [ quantity, this._id, item ] );
    if( result[ 0 ].affectedRows === 1 ) return true;

    result = await dbase.query( queries.insert, [ this._id, item, quantity ] );
    return result[ 0 ].affectedRows === 1;
}

  public async useItem( item:number ):Promise<boolean> {
      this.debug( 'useItem: ' + item );

      const queries:JSONObject = {
        insert: `UPDATE users_vault SET quantity = quantity - 1 WHERE quantity > 0 AND userid = ? AND itemid = ?`,
        delete: `DELETE FROM users_vault WHERE quantity = 0 AND userid = ?`
      }

      const result:RowDataPacket = await dbase.query( queries.insert, [ this._id, item ] );
      if( result[ 0 ].affectedRows !== 1 ) return false;

      await dbase.query( queries.delete, [ this.id ] );
      return true;
  }

  private storeDirty( label:string, value:any ):void {
    switch( typeof( value ) ) {
      case 'number': 
        if( !this._dirty[ label ] ) this._dirty[ label ] = 0;
        this._dirty[ label ] += value;
        break;
      case 'string': 
        this._dirty[ label ] = value;
        break;
      default: console.log( 'ERROR: Unhandled Dirty Type - ' + typeof( value ) );
    }
  }  
  
  public async commit():Promise<boolean> {
    this.debug( 'commit' );

    let updates:any[] = [];
    let debits:any[] = [];
    let params:any[] = [];
    let keys:string[] = Object.keys( this._dirty );
    let land:boolean = false;

    // Grab all the params and mark the debits
    for( let i:number = 0; i < keys.length; i++ ) {
      updates[ keys[ i ] ] = this._dirty[ keys[ i ] ];
      if( typeof( updates[ keys[ i ] ] ) === 'number' ) {
        if( updates[ keys[ i ] ] < 0 ) debits[ keys[ i ] ] = updates[ keys[ i ] ]; 
      }
    }

    // Process updates to values
    keys = Object.keys( updates );
    let setClause:String = '';
    for( let i:number = 0; i < keys.length; i++ ) {
      if( keys[ i ] === 'land' ) land = true;

      switch( typeof( updates[ keys[ i ] ] ) ) {        
        case 'string': setClause += ( i > 0 ? ', ' : ' ' ) + keys[ i ] + ' = ?'; break;
        case 'number': 
            setClause += ( i > 0 ? ', ' : ' ' ) + keys[ i ] + ' = ';
            //setClause += updates[ keys[ i ] ] < 0 ? 'GREATEST( 0, ' : '';
            setClause += keys[ i ] + ' + ?';
            //setClause += updates[ keys[ i ] ] < 0 ? ')' : '';
            break;
      }

      params.push( updates[ keys[ i ] ] );
    }

    // Process the debits
    keys = Object.keys( debits );
    let whereClause:string = ' WHERE';
    /*if( keys.length > 0 ) {
        for( let i:number = 0; i < keys.length; i++ ) {      
        whereClause += ( i > 0 ? ' AND ' : ' ' ) + keys[ i ];
        if( debits[ keys[ i ] ] > 0 ) whereClause += ' <= ';
        else whereClause += '>= ';
        whereClause += '?'//-debits[ keys[ i ] ];

        params.push( -debits[ keys[ i ] ] );
        }
        whereClause += ' AND';
    }*/
    whereClause += ' userid = ? AND roundid = ?';

    params.push( this.id );
    params.push( this.round );        
    
    const query:string = 'UPDATE users_rounds SET' + setClause + whereClause;    
    const result:RowDataPacket = await dbase.query( query, [ ...params ] ); 
    console.log( 'QUERY' );
    console.log( query );
    console.log( params );

    if( result[ 0 ].affectedRows === 1 ) {
      // Clear our dirty values
      this._dirty = [];

      if( land ) {
        const query:string = `SELECT land, land_free FROM users_rounds WHERE userid = ? AND roundid = ?`;
        const result:RowDataPacket = await dbase.getOne( query, [ this.id, this.round ] );
        console.log( 'Loading Land' );

        console.log( result );

        this._land = +result.land;
        this._landFree = +result.land_free;
      }
      return true;
    } else {
        console.log( query );
        console.log( params );

        let result:RowDataPacket = await dbase.getOne( 'SELECT * FROM users_rounds WHERE userid = ? AND roundid = ?', [ this.id, this.round ] );
        console.log( result );
    }

    console.log( 'ERROR IN COMMIT' );
    process.exit( 1 );
    return false;

    /*let dirty:any[] = [ ...this._dirty ];
    console.log( dirty );

    let updates:any[] = [];
    for( let i:number = 0; i < dirty.length; i++ ) {
      const { field, value } = dirty[ i ];
      
      if( updates[ field ] ) updates[ field ] += value;
      else updates[ field ] = value;
    }

    let debits:Object = {};
    let keys = Object.keys( updates );
    console.log( keys );
    for( let i:number = 0; i < keys.length; i++ ) {
      console.log( 'type: ' +  typeof( updates[ keys[ i ] ] ) );
      if( updates[ keys[ i ] ] < 0 ) {        
        if( debits[ keys[ i ] ] ) {
          debits[ keys[ i ] ] = updates[ keys[ i ] ];
          console.log( debits[ keys[ i ] ] );
          console.log( updates[ keys[ i ] ] );
        }
        else debits[ keys[ i ] ] += updates[ keys[ i ] ];
      }
    }

    console.log( updates );
    console.log( debits );

    //const debits:number[] = [];
    //const updates:number[] = [];
    
    /*console.log( this._dirty.keys() );
    for( let key in this._dirty.keys() ) {
      console.log( key );

      if( updates[ key ] ) updates[ key ] += this._dirty[ key ];
      else updates[ key ] = this._dirty[ key ];

      if( this._dirty[ key ] < 0 ) {
        if( debits[ key ] ) debits[ key ] += this._dirty[ key ];
        else debits[ key ] = this._dirty[ key ];
      }
    }*/

    //console.log( updates );
    //console.log( debits );
  }

  async log( action:string, round?:number ):Promise<void> {
		const query = `INSERT INTO users_log SET userid = ?, roundid = ?, action = ?, time = UNIX_TIMESTAMP()`;
		const result = await dbase.query( query, [ this.id, round ? round : this.round, action ] );
  }
  
  async logEnergy( type:string, amount:number ):Promise<void> {
		this.debug( 'logEnergy: ' + type + ':' + amount );
		
  	const query = `INSERT INTO metric_energy_log SET userid = ?, roundid = ?, type = ?, amount = ?, time = UNIX_TIMESTAMP()`;
    const result:RowDataPacket = await dbase.query( query, [ this.id, this.round, type, amount ] );    
	}

	/*async logDupe( $dupe, $type ) {
		this.debug( "logDupe" );	

		let connection = await dbase.beginTransaction();
		let query = "";
		let result;
		
		//Insert the Duplicate record for both sides of the match
		let check = await dbase.getOne( "SELECT id FROM users_dupes WHERE userid = " + this.id + " AND dupe = " + $dupe.userid + " AND type = " + $type );
		if( !check ) {			
			query = "INSERT INTO users_dupes SET userid = " + this.id + ", dupe = " + $dupe.userid + ", type = " + $type + ", time = UNIX_TIMESTAMP()";
			result = await connection.query( query );
			if( !result || result[ 0 ].affectedRows != 1 ) {
				logger.logError( "Error Inserting Dupe: " + query );
			}			
			this.log( "Marked as Duplicate of " + dupe.username );
		}
		
		check = await dbase.getOne( "SELECT id FROM users_dupes WHERE userid = " + $dupe.userid + " AND dupe = " + this.id + " AND type = " + $type );
		if( !check ) {
			query = "INSERT INTO users_dupes SET userid = " + $dupe.userid + ", dupe = " + this.id + ", type = " + $type + ", time = UNIX_TIMESTAMP()";
			result = await connection.query( query );
			if( !result || result[ 0 ].affectedRows != 1 ) {
				logger.logError( "Error Inserting Dupe: " + query );
			}
			
			query = "INSERT INTO users_log SET userid = " + $dupe.userid + ", action = 'Marked as Duplicate of " + validator.unescape( this.username ) + "', time = UNIX_TIMESTAMP()";
			result = await connection.query( query );
			if( !result || result[ 0 ].affectedRows != 1 ) {
				logger.logError( "Error Inserting Dupe: " + query );
			}
		}
		
		await dbase.commit( connection );
	}

	async logIP( $ip ) {
		//See if we've already logged this IP
		const checkIP = await dbase.getOne( "SELECT id FROM users_ips WHERE userid = " + this.id + " AND ip = '" + $ip + "' LIMIT 1" );
		if( !checkIP ) {
			//It's new!  Let's record it and then check for dupes
			const connection = await dbase.beginTransaction();
			const query = "INSERT INTO users_ips SET userid = " + this.id + ", ip = '" + $ip + "'";
			const result = await connection.query( query );
			if( !result || result[ 0 ].affectedRows != 1 ) {
				await dbase.rollback( connection );
				
				logger.logError( "Error Logging IP: " + query );
			} else await dbase.commit( connection );			
			
			const dupes = dbase.get( "SELECT userid, username FROM users_ips INNER JOIN users ON users.id = userid WHERE userid <> " + this.id + " AND ip = '" + $ip + "'" );
			if( dupes ) {
				for( dupe in dupes ) {
					this.logDupe( dupes[ dupe ], 1 );
				}
			}
		}		
	}	

	async logEvent( $evt, $round, $icon ) {
		this.debug( "logEvent: " + $round + " : " + $icon + " : " + $evt );

		//Store the event
		const query = "INSERT INTO events SET userid = " + this.id + ", roundid = " + $round + ", icon = '" + $icon + "', event = '" + $evt + ", time = UNIX_TIMESTAMP()";		
		const connection = await dbase.beginTransaction();
		const result = await connection.query( query );
		if( !result || result[ 0 ].affectedRows != 1 ) {
			await dbase.rollback( connection );
			logger.logError( "Error Logging Event: " + query );
		} else await dbase.commit( connection );		
	}*/

  public trimLight():JSONObject {
    return {
      energy: this._energy,
      resources: this._resources,
      population: this._population,
    }
  }

  public trim():JSONObject {
    //console.log( this );

    return {
      id: this._id,
      username: this._username,
      email: this._email,
      avatar: this._avatar,
      gems: this._gems,
      round: this._round,

      resources: this._resources,
      incomes: this._incomes,
      upkeeps: this._upkeeps,

      energy: this._energy,

      population: this._population,
      populationMax: this._populationMax,

      land: this._land / LAND_PRECISION,
      landFree: this._landFree / LAND_PRECISION,

      build: this._build,
      defense: this._defense,
      recruit: this._recruit,

      buildings: this._buildings,
      units: this._units,

      banned: this._banned,
      banned_reason: this._bannedReason,
      banned_until: this._bannedUntil,                        
    };    
  }

  public trimDetails():JSONObject {
    return {
        energy: this._energy,
        power: this._power,
        land: this._land / LAND_PRECISION,
        landFree: this._landFree / LAND_PRECISION, 
        population: this._population, 
        populationMax: this._populationMax, 
        build: this._build, 
        defense: this._defense, 
        recruit: this._recruit,
        units: this._units,
        buildings: this._buildings,
        resources: this._resources,
        incomes: this._incomes,
        upkeeps: this._upkeeps
    };
  }

  public trimUnits():JSONObject {
    return {
      units: this._units,
      upkeeps: this._upkeeps,
    }
  }

  public trimBuildings():JSONObject {
    return {
      buildings: this._buildings,
      incomes: this._incomes,      
    }
  }

  private debug( msg:string, force:boolean = false, silence:boolean = false ):void {
    if( silence ) return;
    if( this._debug || force )
      logger.logUser( msg );
  }
}