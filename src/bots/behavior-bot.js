var Logger = require( '../logger' );
var WarBot = require( './war-bot' );
var UnitManager = require( '../unit-manager' );

class BehaviorBot extends WarBot {
	constructor( $id, $database ) {
		super( $id, $database );
		
		this._debug = false;		
	}	
	
	async run() {
		if( this.constructor.name == "BehaviorBot" ) this.debug( "running" );
		
		while( this.energy > 0 ) {
			await this.load();
			
			this.debug( "Energy: " + this.energy );
			if( this.energy == 0 ) return false;		
			
			//Make sure we're not going broke
			let result = await this.validateIncomes();		
			if( result ) {
				//We're not going broke!
				let choices = [ "aggressive", "explorer", "gatherer", "builder", "defender" ];
				if( this.population / this.population_max < .8 ) {
					let index = choices.indexOf( "defender" );
					choices.splice( index, 1 );
				}
				
				let decision = await this.makeDecision();
				this.debug( "Decision: " + decision );
				switch( decision ) {
					case "aggressive":
						let target = await this.findTarget();					
						if( target == -1 ) return await this.run();
						
						let type = Math.floor( Math.random() * 2 );
						if( type == 1 ) {
							result = await this.attack( target );
							if( result && result.success && result.turn ) this.attacke += result.energy;
						} else {
							result = await this.raid( target );
							if( result && result.success && result.turn ) this.raided += result.energy;
						}
						break;
					case "explorer": 
						result = await this.explore( 1 ); 
						if( result && result.success && result.energy ) this.explored += result.energy;
						break;
					case "gatherer": 
						result = await this.gather( this.pickGatherType(), 1 ); 
						if( result && result.success && result.turn ) this.gathered += result.energy;
						break;
					case "builder": 
						let building = this.pickBuilding();
						result = await this.buildBuilding( building );
						if( result && result.success && result.turn ) this.built += result.energy;
						break;
					case "defender":
						if( ( ( this.power - ( this.land * 5 ) ) / this.power ) <= this.params.power_from_army ) {
							if( this.population / this.population_max >= .8 ) {
								let unit = this.pickUnit();								
								result = await this.recruitUnit( unit );
								if( result && result.success && result.turn ) this.recruited += result.energy;
							} else {
								await this.buildBuilding( 5 );
							}
						}
						break;
				}					
			}
		}			
	}	
	
	async needLand() {
		let result = await this.makeDecision( [ "aggressive", "explorer" ] );
		this.debug( "needLand: " + result );
		
		switch( result ) {
			case "aggressive":
				let target = await this.findTarget();				
				if( target == -1 ) return await super.needLand();
				else {
					let result = await this.attack( target );
					if( result ) return result;
					
					return await this.explore();
				}
				break;
			case "explorer":
				return await this.explore();
				break;
		}		
	}
	
	async needWood( $val, $choices ) {
		let choices = $choices ? $choices : [ "aggressive", "merchant", "gatherer" ];		
				
		let result = choices.length > 1 ? await this.makeDecision( choices ) : choices[ 0 ];
		this.debug( "needWood: " + $val + " - " + result );
		
		let index = 0;
		
		switch( result ) {
			case "aggressive":
				let target = await this.findTarget();				
				if( target == -1 ) {
					index = choices.indexOf( "aggressive" );
					if( index > -1 ) choices.splice( index, 1 );
				
					return await this.needWood( $val, choices );
				}
				
				result = await this.raid( target );
				if( result ) return result;
				else this.debug( "RAID FAILED" );
				
				index = choices.indexOf( "aggressive" );
				if( index > -1 ) choices.splice( index, 1 );
				
				return await this.needWood( $val, choices );
			case "merchant":
				result = await this.tryToBuy( "wood", $val );
				if( result ) return result;
				
				index = choices.indexOf( "merchant" );
				if( index > -1 ) choices.splice( index, 1 );
				this.debug( choices );
				
				return await this.needWood( $val, choices );				
			case "gatherer":
				return await this.gather( "wood" );				
		}
	}
	
	async needFood( $val, $choices ) {
		let choices = $choices ? $choices : [ "aggressive", "merchant", "gatherer" ];		
		
		let result = choices.length > 1 ? await this.makeDecision( choices ) : choices[ 0 ];
		this.debug( "needFood: " + result );
		
		let index = 0;
		
		switch( result ) {
			case "aggressive":
				let target = await this.findTarget();				
				if( target == -1 ) {
					let index = choices.indexOf( "aggressive" );
					if( index > -1 ) choices.splice( index, 1 );
				
					return await this.needFood( $val, choices );
				}
				
				result = await this.raid( target );
				if( result ) return result;
				
				index = choices.indexOf( "aggressive" );
				if( index > -1 ) choices.splice( index, 1 );
				return await this.needStone( $val, choices );				
			case "merchant":
				result = await this.tryToBuy( "food", $val );
				if( result ) return result;
				
				index = choices.indexOf( "merchant" );
				if( index > -1 ) choices.splice( index, 1 );
				
				return await this.needFood( $val, choices );				
			case "gatherer":
				return await this.gather( "food" );				
		}
	}
	
	async needStone( $val, $choices ) {
		let choices = $choices ? $choices : [ "aggressive", "merchant", "gatherer" ];		
		
		let result = choices.length > 1 ? await this.makeDecision( choices ) : choices[ 0 ];
		this.debug( "needStone: " + result );
		
		let index = 0;
		
		switch( result ) {
			case "aggressive":
				let target = await this.findTarget();				
				if( target == -1 ) {
					let index = choices.indexOf( "aggressive" );
					if( index > -1 ) choices.splice( index, 1 );
				
					return await this.needStone( $val, choices );
				}
				
				result = await this.raid( target );
				if( result ) return result;
				
				index = choices.indexOf( "aggressive" );
				if( index > -1 ) choices.splice( index, 1 );
				return await this.needStone( $val, choices );
			case "merchant":
				result = await this.tryToBuy( "stone", $val );
				if( result ) return result;
				
				index = choices.indexOf( "merchant" );
				if( index > -1 ) choices.splice( index, 1 );
				
				return await this.needStone( choices );
			case "gatherer":
				return await this.gather( "stone" );
				break;
		}
	}
	
	async needMetal( $val, $choices ) {
		let choices = $choices ? $choices : [ "aggressive", "merchant", "gatherer" ];		
		
		let result = choices.length > 1 ? await this.makeDecision( choices ) : choices[ 0 ];
		this.debug( "needMetal: " + result );
		
		let index = 0;
		
		switch( result ) {
			case "aggressive":
				let target = await this.findTarget();				
				if( target == -1 ) {
					let index = choices.indexOf( "aggressive" );
					if( index > -1 ) choices.splice( index, 1 );
				
					return await this.needMetal( $val, choices );
				}
				
				result = await this.raid( target );					
				if( result ) return result;
				
				index = choices.indexOf( "aggressive" );
				if( index > -1 ) choices.splice( index, 1 );
				return await this.needStone( $val, choices );
			case "merchant":
				result = await this.tryToBuy( "metal", $val );
				if( result ) return result;
				
				index = choices.indexOf( "merchant" );
				if( index > -1 ) choices.splice( index, 1 );
				
				return await this.needMetal( $val, choices );
			case "gatherer":
				return await this.gather( "metal" );
				break;
		}
	}
	
	async needGold( $val, $choices ) {
		let choices = $choices ? $choices : [ "aggressive", "merchant", "gatherer" ];		
		
		let result = choices.length > 1 ? await this.makeDecision( choices ) : choices[ 0 ];
		this.debug( "needGold: " + result );
		
		switch( result ) {
			case "aggressive":
				let target = await this.findTarget();				
				if( target == -1 ) {
					let index = choices.indexOf( "aggressive" );
					if( index > -1 ) choices.splice( index, 1 );
				
					return await this.needGold( $val, choices );
				} else {
					let result = await this.raid( target );
					if( result ) return result;
					
					let index = choices.indexOf( "aggressive" );
					if( index > -1 ) choices.splice( index, 1 );
					return await this.needStone( $val, choices );
				}
				break;
			case "merchant":
				let result = await super.sellForGold( $val );
				if( result ) return result;
				
				let index = choices.indexOf( "merchant" );
				if( index > -1 ) choices.splice( index, 1 );
				
				return await this.needGold( $val, choices );
				break;
			case "gatherer":
				return await this.gather( "gold" );
				break;
		}
	}
	
	pickGatherType() {
		this.debug( "pickGatherType" );
		
		let roll = Math.random() * 5;
		
		switch( roll ) {
			case 0: return "wood";
			case 1: return "stone";
			case 2: return "metal";
			case 3: return "gold";
			case 4: return "food";
		}
		
		return "gold";
	}
	
	async makeDecision( traits ) {
		//this.debug( "makeDecision" + ( traits ? ": " + traits : "" ), false, false );
		if( !this.params.personality ) return false;
		
		if( !traits ) traits = [ "aggressive", "merchant", "gatherer", "explorer", "defender", "builder" ];
		
		if( traits.length == 1 ) {
			let roll = Math.floor( Math.random() * 10 );
			
			if( roll <= this.params.personality[ traits[ 0 ] ] ) return true;
			return false;
		} else {		
			let total = 0;
			
			for( var t in traits ) total += this.params.personality[ traits[ t ] ];
			let choice = Math.floor( Math.random() * total ) + 1;
			//this.debug( "Choice Value: " + choice );
			
			if( total == 0 ) return traits[ traits.length - 1 ];
			
			for( var i = 0; i < traits.length; i++ ) {
				//this.debug( "Choice Value: " + choice + " : " + this.params.personality[ traits[ i ] ] );
				
				if( choice <= this.params.personality[ traits[ i ] ] ) return traits[ i ];
				else choice -= this.params.personality[ traits[ i ] ];							
			}
			
			//this.debug( "Failed to make choice?" );
			
			return false;
		}
	}
		
	debug( $msg, $force, $silence ) {
		if( $silence ) return;		
		if( this._debug || $force )
			console.log( "BehaviorBot(" + this.id + "): " + $msg );			
	}
}

module.exports = BehaviorBot;