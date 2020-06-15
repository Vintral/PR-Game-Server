import logger from '../logger';
import dbase from '../database';
import { RowDataPacket } from 'mysql2/promise';
import { JSONObject } from '../interfaces';
import { User } from '../models';

export default class ActionsController {
  private _debug: boolean = true;

  public async process(data: JSONObject, user: User): Promise<JSONObject> {
    console.log(data);
    console.log(data.command);

    switch (data.command) {
      case 'explore': return await this.processExplore(data, user);
      case 'gather': return await this.processGather(data, user);
      case 'build': return await this.processBuild(data, user);
      case 'recruit': return await this.processRecruit(data, user);
      default: {
        console.log('Unhandled Command: ' + data.command);
      }
    }
    return {};
  }

  private error(msg: string, type: string = 'ERROR'): JSONObject {
    console.log('ERROR: ' + msg);
    return { type: 'ERROR', data: msg };
  }

  private async processBuild(data: JSONObject, user: User): Promise<JSONObject> {
    this.debug('processBuild');

    const { type, quantity } = data;

    if (!quantity || quantity <= 0) return this.error('Invalid amount', 'ERROR_BUILDING');
    if (!type) return this.error('Invalid Building', 'ERROR_BUILDING');

    user.log('Build: ' + type + ':' + quantity);
    
    if (user.landFree < quantity) return this.error('Not Enough Available Land', 'ERROR_BUILDING');

    //Grab the building data and calculate the costs
    const building: RowDataPacket = await dbase.getOne(`SELECT * FROM buildings WHERE type = ?`, [type]);    
    const energy: number = Math.ceil((quantity * building.cost_points) / user.buildPower );
    const wood: number = Math.ceil(quantity * building.cost_wood);
    const stone: number = Math.ceil(quantity * building.cost_stone);

    //Validate that we can afford it
    if (user.energy < energy) return this.error('You Don\'t Have Enough Energy', 'ERROR_BUILDING');
    if (user.wood < wood) return this.error('You Don\'t Have Enough Wood', 'ERROR_BUILDING');
    if (user.stone < stone) return this.error('You Don\'t Have Enough Stone', 'ERROR_BUILDING');
    
    try {
      user.landFree -= quantity;
      user.wood -= wood;
      user.stone -= stone;
      user.energy -= energy;
      user.energySpent += energy;
      let result:boolean = await user.commit();
      if( !result ) return this.error( 'Error Building(1)', 'ERROR_BUILDING' );

      result = await user.build( building.id, quantity );
      if( !result ) {
        user.landFree += quantity;
        user.wood += wood;
        user.stone += stone;
        user.energy += energy;
        user.energySpent -= energy;
        result = await user.commit();
        if( !result ) {
          let msg:string = 'Lost ';
          if( wood ) msg += wood + ' wood ';
          if( stone ) msg += stone + ' stone ';
          if( energy ) msg += energy + ' energy ';
          logger.logError( 'UserID(' + user.id + '): ' + msg );
        } else return this.error( 'Error Building(2)', 'ERROR_BUILDING' );
      }

      await user.updateDeltas();
      
      const message: string = 'Successfully built ' + quantity + ' ' + (quantity !== 1 ? building.plural : building.name);      
      user.log(message);

      return { type: 'BUILT', data: { message, user: user.trim() } };
    } catch (err) {
      logger.logError('Error: ' + err);
    }

    const message: string = 'Build Test';
    return { type: 'BUILT', data: { message, user: user.trim() } };
  }

  private async processRecruit(data: JSONObject, user: User): Promise<JSONObject> {
    this.debug('processRecruit');

    const { type, quantity } = data;

    if (!quantity || quantity <= 0) return this.error('Invalid amount', 'ERROR_RECRUITING');
    if (!type) return this.error('Invalid Building', 'ERROR_RECRUITING');

    user.log('Recruit: ' + type + ':' + quantity);
    
    if (user.population < quantity - 1) return this.error('Not Enough Population', 'ERROR_RECRUITING');

    // Grab the unit data and calculate the costs
    const unit: RowDataPacket = await dbase.getOne(`SELECT * FROM units WHERE type = ?`, [type]);
    const energy: number = Math.ceil( quantity * unit.cost_points / user.recruitPower );
    const gold: number = Math.ceil( quantity * unit.cost_gold );
    const available: boolean = unit.available === 1;
    const recruitable: boolean = unit.recruitable === 1;
    
    //Validate that we can afford it
    if (user.energy < energy) return this.error('You Don\'t Have Enough Energy', 'ERROR_RECRUITING');
    if (user.gold < gold) return this.error('You Don\'t Have Enough Gold', 'ERROR_RECRUITING');
    if (user.population < quantity) return this.error('You Don\'t Have Enough Population', 'ERROR_RECRUITING');
    if( !available ) return this.error('Unit Not Available', 'ERROR_RECRUITING' );
    if( !recruitable ) return this.error( 'Unit Not Recruitable', 'ERROR_RECRUITING' );
    
    try {
      user.gold -= gold;
      user.population -= quantity;
      user.energy -= energy;
      user.energySpent += energy;
      let result:boolean = await user.commit();
      if( !result ) return this.error( 'Error Recruiting(1)', 'ERROR_RECRUITING' );

      result = await user.recruit( unit.id, quantity );
      if( !result ) {
        user.gold += gold;
        user.population += quantity;        
        user.energy += energy;
        user.energySpent -= energy;
        result = await user.commit();
        if( !result ) {
          let msg:string = 'Lost ';
          if( gold ) msg += gold + ' gold ';
          if( quantity ) msg += quantity + ' people ';
          if( energy ) msg += energy + ' energy ';
          logger.logError( 'UserID(' + user.id + '): ' + msg );
        } else return this.error( 'Error Recruiting(2)', 'ERROR_RECRUITING' );
      }

      await user.updateDeltas();
      await user.calculatePower( user.round );
      
      const message: string = 'Successfully recruited ' + quantity + ' ' + (quantity !== 1 ? unit.plural : unit.name);      
      user.log(message);

      return { type: 'RECRUITED', data: { message, user: user.trim() } };
    } catch (err) {
      logger.logError('Error: ' + err);
    }

    const message: string = 'Recruit Test';
    return { type: 'RECRUITED', data: { message, user: user.trim() } };
  }

  private async processGather(data: JSONObject, user: User): Promise<JSONObject> {
    this.debug('processGather');

    console.log( user );

    const { energy, type } = data;

    if (energy > user.energy) return this.error('You Don\'t Have That Much Energy!');
    if (energy <= 0) return this.error('Invalid Energy Amount');

    let tick:number|undefined = 0;
    switch( type ) {
      case 'wood': tick = user.incomes.wood; break;
      case 'stone': tick = user.incomes.stone; break;
      case 'gold': tick = user.incomes.gold; break;
      case 'food': tick = user.incomes.food; break;
      case 'metal': tick = user.incomes.metal; break;
    }
    if( !tick || tick < 1 ) tick = 1;

    const random: number = Math.floor(Math.random() * 40) + 80;
    let total: number = (tick * energy * random) / 100.0;
    if (total < 1) total = 1;

    console.log( 'Total: ' + total );

    user.energy -= energy;
    switch( type ) {
      case 'wood': user.wood += total; break;
      case 'stone': user.stone += total; break;
      case 'gold':  user.gold += total; break;
      case 'food': user.food += total; break;
      case 'metal': user.metal += total; break;
    }

    //console.log( type );
    //user[ type ] += total;
    const success:boolean = await user.commit();
    console.log( 'Stored?: ' + success );

    let delta: number = Math.floor(parseFloat(user.resources[data.type]) + total - Math.floor(parseFloat(user.resources[data.type])));

    /*let field: string = '';
    switch (data.type) {
      case 'wood': field = 'wood_income'; break;
      case 'stone': field = 'stone_income'; break;
      case 'gold': field = 'gold_income'; break;
      case 'food': field = 'food_income'; break;
      case 'metal': field = 'metal_income'; break;
      default:
        logger.logError('Can\'t Gather: ' + data.type);
        return this.error('Invalid Resource Type');
    }

    const queries = {
      retrieve: `SELECT ${field} AS tick FROM users_rounds WHERE userid = ? AND roundid = ?`,
      update: `UPDATE users_rounds SET energy = energy - ?, energy_spent = energy_spent + ?, ${data.type} = ${data.type} + ? WHERE userid = ? AND roundid = ? AND energy >= ? LIMIT 1`
    }*/

    //Grab our current tick, set to 1 as a minimum
    /*let retrieve: RowDataPacket = await dbase.getOne(queries.retrieve, [user.id, user.round]);
    const tick: number = retrieve.tick < 1 ? 1 : retrieve.tick;

    let random: number = Math.floor(Math.random() * 40) + 80;
    let total: number = (tick * data.energy * random) / 100.0;
    if (total < 1) total = 1;

    let result: RowDataPacket = await dbase.query(queries.update, [data.energy, data.energy, total, user.id, user.round, data.energy]);
    if (result[0].affectedRows !== 1) return this.error('Error Gathering');

    user.log("Gather: " + data.type + ":" + data.energy);
    user.logEnergy("gather", data.energy);

    console.log(user.resources[data.type]);
    console.log(total);
    let delta: number = Math.floor(parseFloat(user.resources[data.type]) + total - Math.floor(parseFloat(user.resources[data.type])));
    console.log(delta);*/

    let message: string = 'You spent ' + data.energy + ' energy gathering, and found ' + delta + ' ' + data.type;
    console.log(message);
    user.log(message);

    //user.energy -= data.energy;
    //user.resources[data.type] = parseFloat(user.resources[data.type]) + total;

    return { type: 'GATHER', data: { message, user: user.trim() } };
  }

  private async processExplore(data: JSONObject, user: User): Promise<JSONObject> {
    this.debug('processExplore');

    if (data.energy > user.energy) return this.error('You Don\'t Have That Much Energy!');
    if (data.energy <= 0) return this.error('Invalid Energy Amount');

    const queries = {
      getLand: `SELECT land FROM users_rounds WHERE userid = ? AND roundid = ?`,
      updateUser: `UPDATE users_rounds SET energy = energy - ?, energy_spent = energy_spent + ?, land = land + ?, land_free = land_free + ? WHERE userid = ? AND roundid = ? AND energy >= ?`,
    }

    let result: RowDataPacket = await dbase.getOne(queries.getLand, [user.id, user.round]);
    //user.land = parseFloat(result.land);
    let land: number = user.land;

    let energy: number = data.energy;
    let gain: number = 0;
    let increase: number = 0;

    while (energy > 0) {
      if (land <= 100) {
        gain = Math.random() * 10 + 3;
      } else if (land <= 200) {
        gain = Math.random() * 7.5 + 2;
      } else if (land <= 400) {
        gain = Math.random() * 5 + 1.5;
      } else if (land <= 800) {
        gain = Math.random() * 2.5 + 1;
      } else if (land <= 1300) {
        gain = Math.random() * 1 + .3;
      } else if (land <= 1500) {
        gain = Math.random() * .5 + .2;
      } else if (land <= 2500) {
        gain = Math.random() * .25 + .1;
      } else {
        gain = Math.random() * .15 + .05;
      }

      console.log('Gain: ' + gain);

      increase += gain;
      land += gain;
      energy--;
    }

    const delta: number = Math.floor(user.land + increase - Math.floor(user.land));
    user.energy -= data.energy;    
    user.land += +increase;
    user.landFree += +increase;
    user.calculatePower( user.round );
    const commited:boolean = await user.commit();
    console.log( 'Stored: ' + commited.toString() );

    //Prepare the return packet		
    const message = 'You spent ' + data.energy + ' energy exploring, and found ' + (delta === 0 ? ' no land' : delta + ' acre' + (delta == 1 ? '' : 's') + ' of land');

    user.logEnergy("explore", data.energy);
    user.log(data.msg);

    return { type: 'EXPLORE', data: { message, user: user.trim() } };
  }

  private debug(msg: string): void {
    if (this._debug)
      logger.logServer('ActionsController: ' + msg);
  }
}