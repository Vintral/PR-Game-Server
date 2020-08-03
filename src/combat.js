const Logger = require( './logger' );
const UnitManager = require ( './unit-manager' );

class Combat {	
	constructor( database, attacker, defender, $round ) {
		this._debug = true;
        
        this.simulate = false;
        this.simulateTimes = 1;
        
		this.database = database;
        this.attacker = attacker;
        this.defender = defender;
        this.round = $round;

        this.attackingPower = 0;
        this.defendingPower = 0;

        this.error = "";

        this.attackEnergy = 10;
        this.raidEnergy = 5;

        this.victory = false;
        this.log = [];
	}
    
    //======================//
	//	Combat Methods   	//
    //======================//
    async Raid() {
		this.debug( "Raid" );

		if( this.attacker.energy <= this.raidEnergy ) return this.setError( "Not enough energy!" );
        if( ( this.defender.power > this.attacker.power * 2 ) || ( this.defender.power < this.attacker.power / 2 ) ) return this.setError( "Out of range" );
        
        if( !this.attacker.army || this.attacker.army.length === 0 ) return this.setError( "You have no army!" );
		
		let attacker = {};
		attacker.username = this.username;
		attacker.army = attackingArmy;
		
		defender.army = defendingArmy;
		
		//Get our power to build the success ratio
		let attackingPower = attacker.army[ 0 ].power * attacker.army[ 0 ].quantity;
		let defendingPower = 0;
		for( let d in defender.army ) defendingPower += defender.army[ d ].power * defender.army[ d ].quantity;

		this.debug( "AttackingPower: " + attackingPower );
		this.debug( "DefendingPower: " + defendingPower );
		let ratio = defendingPower > 0 ? attackingPower / defendingPower * 100 : 0;
							
		let roll = Math.floor( ( Math.random() * 100 ) + 1 );
		let data = {};

		this.debug( "Ratio: " + ratio );
		this.debug( "Roll: " + roll );
		this.debug( "Caught? " + ( roll < ratio ) );
		
		//We were caught!
		if( roll <= ratio ) {
			let log = "";

			for( let i = 0; i < defender.army.length; i++ ) {
				let combat = await this.processUnitCombat( defender.army[ i ], attacker.army[ 0 ], defender.username, this.username );				
				if( combat ) {
					if( !attacker.army[ 0 ].killed )  attacker.army[ 0 ].killed = 0;
					attacker.army[ 0 ].killed += combat.killed;					
					log += ( log != "" ? "\n" : "" ) + combat.message;
				}

				if( attacker.army[ 0 ].alive == 0 ) break;
			}

			let loss = attacker.army[ 0 ].alive - attacker.army[ 0 ].quantity;
			let summary = "Your raiders were caught!";
			if( loss ) summary += "\n\nYou lost " + loss + " " + ( loss != 1 ? attacker.army[ 0 ].plural : attacker.army[ 0 ].name );

			data.log = log;
			data.result = summary;
			data.won = false;

			let connection = await this.database.beginTransaction();
			let query = "UPDATE users_rounds SET energy_spent = energy_spent + " + energy + ", energy = energy - " + energy + " WHERE userid = " + this.id + " AND roundid = " + this.round + " AND energy >= 1";
			let result = await connection.query( query );
			if( !result || result[ 0 ].affectedRows != 1 ) {
				await this.database.rollback( connection );
				
				Logger.logError( "Error Raiding: " + query );
				return this.dispatchError( "Error raiding" );
			}
			
			if( attacker.army[ 0 ].killed ) {
				if( attacker.army[ 0 ].quantity > 0 )
					query = "UPDATE users_rounds_units SET quantity = quantity - " + attacker.army[ 0 ].killed + " WHERE userid = " + this.id + " AND roundid = " + this.round + " AND unitid = " + attacker.army[ 0 ].id + " AND quantity > " + attacker.army[ 0 ].killed;
				else query = "DELETE FROM users_rounds_units WHERE userid = " + this.id + " AND roundid = " + this.round + " AND unitid = " + attacker.army[ 0 ].id;
				
				result = await connection.query( query );
				if( !result || result[ 0 ].affectedRows != 1 ) {
					await this.database.rollback( connection );
					
					Logger.logError( "Error Raiding: " + query );
					return this.dispatchError( "Error raiding" );
				}
			}
			
			await this.database.commit( connection );
			
			data.log = Buffer.from( data.log ).toString( "base64" );
			data.result = Buffer.from( data.result ).toString( "base64" );
			data.victory = false;			
		} else {
			// Turn ratio into percentage
			ratio /= 100;
			
			data.log = "Your " + attacker.army[ 0 ].quantity + " " + ( attacker.army[ 0 ].quantity == 1 ? attacker.army[ 0 ].name : attacker.army[ 0 ].plural ) + " " + ( attacker.army[ 0 ].quantity == 1 ? "wasn't" : "weren't" ) + " detected";

			data.won = true;
			data.result = "Take Stuff";

			const connection = await this.database.beginTransaction();
			
			let query = "SELECT wood, food, gold, metal, stone FROM users_rounds WHERE userid = " + defender.id + " AND roundid = " + this.round + " LIMIT 1";
			let loot = await connection.query( query );
			loot = loot[ 0 ][ 0 ];			
			if( !loot ) {
				Logger.logError( "Error Raiding: " + loot );
				return this.dispatchError( "Error raiding" );
			}
			
			let max = 10;
			let min = 5;
			let wood = Math.floor( ( Math.random() * ( max - min ) + min ) * loot.wood / 100 * ratio );
			let food = Math.floor( ( Math.random() * ( max - min ) + min ) * loot.food / 100 * ratio );
			let gold = Math.floor( ( Math.random() * ( max - min ) + min ) * loot.gold / 100 * ratio );
			let stone = Math.floor( ( Math.random() * ( max - min ) + min ) * loot.stone / 100 * ratio );
			let metal = Math.floor( ( Math.random() * ( max - min ) + min ) * loot.metal / 100 * ratio );

			
			let defenderUpdate = "UPDATE users_rounds SET wood = wood - " + wood + ", stone = stone - " + stone + ", gold = gold - " + gold + ", food = food - " + food + ", metal = metal - " + metal + " WHERE userid = " + defender.id + " AND roundid = " + this.round + " AND wood >= " + wood + " AND stone >= " + stone + " AND gold >= " + gold + " AND food >= " + food;
			let attackerUpdate = "UPDATE users_rounds SET energy_spent = energy_spent + " + energy + ", energy = energy - " + energy + ", wood = wood + " + wood + ", stone = stone + " + stone + ", gold = gold + " + gold + ", food = food + " + food + ", metal = metal + " + metal + " WHERE userid = " + this.id + " AND roundid = " + this.round + " AND energy >= " + energy;					
						
			let result = await connection.query( defenderUpdate );
			if( !result || result[ 0 ].affectedRows != 1 ) {
				await this.database.rollback( connection );
				
				Logger.logError( "Error Raiding: " + defenderUpdate );
				return this.dispatchError( "Error raiding" );
			}
			
			result = await connection.query( attackerUpdate );
			if( !result || result[ 0 ].affectedRows != 1 ) {
				await this.database.rollback( connection );
				
				Logger.logError( "Error Raiding: " + attackerUpdate );
				return this.dispatchError( "Error raiding" );
			}
					
			await this.database.commit( connection );					
			
			if( wood > 0 || food > 0 || gold > 0 || metal > 0 ) {
				if( wood > 0 ) result = wood + " wood";
				if( stone > 0 ) result = ( result != "" ? result + ", " : "" ) + stone + " stone";
				if( metal > 0 ) result = ( result != "" ? result + ", " : "" ) + metal + " metal";
				if( food > 0 ) result = ( result != "" ? result + ", " : "" ) + food + " food";
				if( gold > 0 ) result = ( result != "" ? result + ", " : "" ) + gold + " gold";

				result = "You looted " + result;
			}

			if( result == "" )
				result = defender.username + " has nothing for you to take!";

			data.victory = true;
			data.result = result;
		}
		
		data.log = Buffer.from( data.log ).toString( "base64" );
		data.result = Buffer.from( data.result ).toString( "base64" );
		
		this.saveFight( defender, "raid", data.victory, data.log, data.result );
		
        this.logenergy( "raid", energy );
            
		return { success:true, energy:energy };
	}

    async Attack() {
        this.debug( "Attack" );

        // Validate this attack and make sure we're good
        if( this.attacker.energy <= this.attackEnergy ) return this.setError( "Not enough energy!" );
        if( ( this.defender.power > this.attacker.power * 2 ) || ( this.defender.power < this.attacker.power / 2 ) ) return this.setError( "Out of range" );

        // We're good, let's do this
        await this.processCombat();
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

			this.updateDeltas();
			this.updateDeltas( defender.id );
			this.update();
			
			this.logenergy( "attack", energy );
			return { success:true, energy:energy };
		} catch( err ) {
			await this.database.rollback( connection );
			Logger.logError( err );
			return this.dispatchError( "Error processing attack" );
		}

        return true;
    }
    
	//======================//
	//	Loading Methods 	//
	//======================//
	async Load() {
        if( !this.database ) throw( "MISSING DATABASE" );
		
        this.debug( "Load" );

        const baseQuery = "SELECT users.id, power, username, energy FROM users INNER JOIN users_rounds ON users_rounds.userid = users.id WHERE users_rounds.roundid = " + this.round + " AND ";
        const defenderQuery = baseQuery + "username = '" + this.defender + "'";
        const attackerQuery = baseQuery + "users.id = " + this.attacker;

        this.defender = await this.database.getOne( defenderQuery );
        this.attacker = await this.database.getOne( attackerQuery );
        
        await this.loadArmies();

        console.log( this.attacker );
        console.log( this.defender );
    }

    async loadUnits( units ) {
        this.debug( "loadUnits" );

        units = units.map( ( unit ) => {
            let quantity = unit.quantity;
            unit = UnitManager.getUnitByID( unit.unitid );
            unit.quantity = quantity;

            return unit;
        } );

        return units;
    }

    async loadArmies() {
        this.debug( "loadArmies" );

        //Grab the armies and build them
		let attackingArmy = await this.database.get( "SELECT unitid, quantity FROM users_rounds_units WHERE userid = " + this.attacker.id + " AND roundid = " + this.round );
		let defendingArmy = await this.database.get( "SELECT unitid, quantity FROM users_rounds_units WHERE userid = " + this.defender.id + " AND roundid = " + this.round );			
        
        if( !attackingArmy || attackingArmy.length < 1 ) return this.setError( "You have no army to attack with" );

        attackingArmy = await this.loadUnits( attackingArmy );
        defendingArmy = await this.loadUnits( defendingArmy );
        
        this.attacker.army = attackingArmy;
        this.defender.army = defendingArmy;

        this.attackingPower = attackingArmy.reduce( ( power, unit ) => { return power + ( unit.quantity * unit.power ) }, 0 );
        this.defendingPower = defendingArmy.reduce( ( power, unit ) => { return power + ( unit.quantity * unit.power ) }, 0 );

        console.log( this.attacker );
    }

    //======================//
	//	Process Methods 	//
	//======================//
    async processUnitLosses( $player, $connection ) {
		this.debug( "processUnitLosses" );
		
		let ret = {};
		ret.lost = "";
		
		for( let a in $player.army ) {
			if( $player.army[ a ].killed ) {
				ret.lost += ( ret.lost != "" ? ", " : "" ) + $player.army[ a ].killed + " " + ( $player.army[ a ].killed != 1 ? $player.army[ a ].plural : $player.army[ a ].name );
				
				let query = "";
				if( $player.army[ a ].quantity > 0 ) query = "UPDATE users_rounds_units SET quantity = quantity - " + $player.army[ a ].killed + " WHERE roundid = " + this.round + " AND userid = " + $player.id + " AND unitid = " + $player.army[ a ].id;
				else query = "DELETE FROM users_rounds_units WHERE userid = " + $player.id + " AND roundid = " + this.round + " AND unitid = " + $player.army[ a ].id;
								
				const result = await $connection.query( query );
				if( !result || result[ 0 ].affectedRows != 1 ) {
					ret.error = query;
					return ret;
				}
			}
		}
		
		return ret;
    }

    async processBuildingLosses( $defender, $record, $connection ) {
		this.debug( "processBuildingLosses" );
		
		let ret = {};
		
		for( let b in $record.buildings ) {
			if( $record.buildings[ b ].destroyed ) {
				let query = "";
				
				if( $record.buildings[ b ].destroyed == $record.buildings[ b ].quantity ) query = "DELETE FROM users_rounds_buildings WHERE userid = " + $defender.id + " AND roundid = " + this.round + " AND buildingid = " + $record.buildings[ b ].buildingid;
				else query = "UPDATE users_rounds_buildings SET quantity = quantity - " + $record.buildings[ b ].destroyed + " WHERE userid = " + $defender.id + " AND roundid = " + this.round + " AND buildingid = " + $record.buildings[ b ].buildingid;
				let result = await $connection.query( query );
				if( !result || result[ 0 ].affectedRows != 1 ) {
					ret.error = query;
					return ret;
				}
			}
		}
		
		ret.success = true;
		return ret;
    }

    async processCombat() {
        this.debug( "processCombat" );

		let ret = {};
        
        if( this.defender.army.length === 0 ) { 
            this.victory = true;
            this.log.push( "No Defenders" );
            return;            
        }
        
        let unit = "";
        let combat;
        
        let attackerUnits = this.attacker.army.slice();
        let processedAttackers = [];
        let attackerPowerLoss = 0;
        
        let defenderUnits = this.defender.army.slice();		
        let processedDefenders = [];
        let defenderPowerLoss = 0;
    
        while( attackerUnits.length > 0 || defenderUnits.length > 0 ) {				
            unit = attackerUnits.shift();
            if( unit ) {
                processedAttackers.push( unit );
                let defender = defenderUnits.length > 0 ? defenderUnits[ 0 ] : processedDefenders[ processedDefenders.length - 1 ];					
                if( defender && defender.quantity > 0 ) {
                    combat = await this.processUnitCombat( unit, defender, this.attacker.username, this.defender.username );						
                    if( combat ) {
                        if( !defender.killed ) defender.killed = 0;
                        defender.killed += combat.killed;
                        defenderPowerLoss += defender.power * combat.killed;
                        this.log.push( combat.message );
                    }
                }
            }
                
            do{
                unit = defenderUnits.shift();
            } while( unit && unit.quantity <= 0 && defenderUnits.length != 0 );				
            if( unit && unit.quantity && unit.quantity > 0 ) {					
                processedDefenders.push( unit );
                let defender = processedAttackers[ processedAttackers.length - 1 ];
                if( defender && defender.quantity > 0 ) {
                    combat = await this.processUnitCombat( unit, defender, this.defender.username, this.attacker.username );						
                    if( combat ) {						
                        if( !defender.killed ) defender.killed = 0;
                        defender.killed += combat.killed;
                        attackerPowerLoss += defender.power * combat.killed;
                        this.log.push( combat.message );
                    }
                }
            }
        }
        
        ret.attackerLoss = attackerPowerLoss / attackerPower;
        ret.defenderLoss = defenderPowerLoss / defenderPower;
        
        //Compare the ratio of lost power to determine winner
        this.victory = ( attackerPowerLoss / attackerPower ) < ( defenderPowerLoss / defenderPower ) ? true : false;
    }

    async processCombatDefeat( $loser ) {
		this.debug( "processCombatDefeat" );
		
		let ret = {};
		ret.gain = 0;
		ret.destroy = 0;
		ret.free = 0;
	
		const data = await this.database.getOne( "SELECT land FROM users_rounds WHERE userid = " + $loser.id + " AND roundid = " + this.round );
		if( !data ) { ret.error = true; return ret; }
		
		//Determine the land lost
		let seed = Math.floor( data.land * .02 );
		let gain = Math.floor( ( Math.random() * seed / 2 ) + ( seed / 2 ) );

		ret.gain = gain;

		//We took land, destroy some buildings
		if( gain > 0 ) {
			const buildingQuery = "SELECT name, plural, buildingid, quantity FROM users_rounds_buildings INNER JOIN buildings ON buildings.id = buildingid WHERE userid = " + $loser.id + " AND roundid = " + this.round + " ORDER BY quantity ASC";
			let buildings = await this.database.get( buildingQuery );
			if( buildings && buildings.length > 0 ) {
				let free = 0; //The land we need to free up
				let length = buildings.length;
				let toDestroy = Math.floor( ( Math.random() * gain * 2 ) + gain );
				let destroyed = "";
				
				let totalBuildings = 0;
				for( let b in buildings ) totalBuildings += buildings[ b ].quantity;
								
				for( let i = 0; i < toDestroy; i++ ) {
					let building = Math.random() * totalBuildings;//Math.floor( ( Math.random() * length - 1 ) + 1 );					
					for( let b in buildings ) {
						if( building < buildings[ b ].quantity ) {
							if( !buildings[ b ].destroyed ) buildings[ b ].destroyed = 0;
							if( buildings[ b ].destroyed < buildings[ b ].quantity ) {
								buildings[ b ].destroyed++;
							
								totalBuildings--;
								free++;
								break;
							}
						} else building -= buildings[ b ].quantity;
					}									
				}
                
				for( let b in buildings ) {					
					if( buildings[ b ].destroyed && buildings[ b ].destroyed > 0 ) {						
						if( buildings[ b ].destroyed && buildings[ b ].destroyed > 0 ) {
							destroyed += ( destroyed != "" ? ( b == buildings.length - 1 ? ", and " : ", " ) : "" ) + buildings[ b ].destroyed + " " + ( buildings[ b ].destroyed != 1 ? buildings[ b ].plural : buildings[ b ].name );
						}						
					}
				}
				
				//toDestroy = Math.floor( ( Math.random() & ( free - gain ) / 4 ) + ( free - gain ) / 2 );				
				ret.destroy = toDestroy - free;//toDestroy < 0 ? 0 : toDestroy;
				ret.free = free;//free - gain - toDestroy;
				ret.buildings = buildings;
				ret.destroyed = "You destroyed " + destroyed;
			}
		}			
		
		return ret;
    }
    
    async processUnitCombat( $attacker, $defender, $attackerName, $defenderName ) {
		if( $defender.quantity == 0 ) return;

		let damage = Math.ceil( ( Math.random() * $attacker.quantity * $attacker.attack / 2) + ( $attacker.quantity * $attacker.attack / 2 ) );
		let killed = Math.floor( damage / $defender.health );
		if( killed > $defender.quantity ) killed = $defender.quantity;

		$defender.quantity -= killed;
		if( $defender.quantity < 0 ) $defender.quantity = 0;

		let msg = $attackerName + "'s " + $attacker.quantity + " " + ( $attacker.quantity == 1 ? $attacker.name : $attacker.plural ) + " did " + damage + " damage to " + $defenderName + "'s " + ( $defender.quantity == 1 ? $defender.name : $defender.plural ) + ( killed >= 1 ? " killing " + ( $defender.quantity == 0 ? "all of them!" : killed + " " + ( killed == 1 ? $defender.name : $defender.plural ) ) : "" );
		return { killed, message:msg };
	}
    
    //======================//
	//	Methods         	//
    //======================//
    Simulate( times ) {
        this.simulate = true;
        this.simulateTimes = times ? times : 1;
    }

    async saveFight( $defender, $type, $victory, $log, $result ) {		
		let fid = guid.v4();
		let logQuery = "INSERT INTO fights SET guid = '" + fid + "', type = '" + $type + "', attacker = " + this.id + ", defender = " + $defender.id + ", roundid = " + this.round + ", winner = " + ( $victory ? this.id : $defender.id ) + ", combat = '" + $log + "', result = '" + $result + "', time = UNIX_TIMESTAMP()";        

		const connection = await this.database.beginTransaction();
		const result = await connection.query( logQuery );
		if( result && result[ 0 ].affectedRows == 1 ) {
            await this.database.commit( connection );
            
            this.attacker.calculatePower( this.round );
            this.defender.calculatePower( this.round );

			this.dispatchCombatFinalized( fid, $victory, $result );
		} else {
			await this.database.rollback( connection );
			Logger.logError( "Error Saving Fight: " + loqQuery );
		}		
	}
    
    setError( $err ) {
        this.error = $err;
        return false;
    }
	
	debug( $msg ) {
		if( this._debug ) 
			Logger.logCombat( $msg );
	}
}

module.exports = Combat;