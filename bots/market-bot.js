var Logger = require( '../logger' );
var BuilderBot = require( './builder-bot' );
var UnitManager = require( '../unit-manager' );

class MarketBot extends BuilderBot {
	constructor( $id, $database ) {
		super( $id, $database );
		
		this._debug = false;
		this.errors = 0;
	}	
	
	async run() {
		if( this.constructor.name == "MarketBot" ) this.debug( "run" );		
		await super.run();
	}	
	
	async getProductionRatio( $type ) {
		let income = 5000000;
		
		switch( $type ) {
			case "food": income = this.foodincome;
			case "metal": income = this.metalincome;
			case "wood": income = this.woodincome;
		}
		
		return income / this.goldincome;
	}

	async getPrice( $type ) {
		this.debug( "getPrice: " + $type );
		
		let result = await this.database.getOne( "SELECT price FROM market WHERE roundid = " + this.currentRound + " AND type = '" + $type + "' LIMIT 1" );
		return result.price;
	}
	
	async tryToBuy( $type, $val ) {
		let data = await this.database.getOne( "SELECT * FROM market WHERE type = '" + $type + "' AND roundid = " + this.currentRound );
		let available = data.total_sold - data.total_bought;
		if( available <= 0 ) {
			//this.debug( "No " + $type + " for sale" );
			return false;
		}
		
		if( ( data.price > ( this.goldincome / this[ $type + "income" ] ) ) || ( this.gold <= ( this[ $type ] * 4 ) ) ) {
			//this.debug( $type + " is too inefficient to buy" );
			return false;
		}
		
		let quantity = available > $val ? $val : available;
		if( this.gold < Math.ceil( quantity * data.price ) )
			return await this.needGold( Math.ceil( quantity * data.price ) - this.gold );
		
		return await this.buyResource( $type, quantity, data.price );
	}
	
	async sellForGold( $val ) {
		let threshold = 4;
		
		if( this.food > this.wood * threshold && this.food > this.stone * threshold && this.food > this.metal * threshold ) return await this.sellResource( "food", this.foodincome, await this.getPrice( "food" ) );
		if( this.wood > this.food * threshold && this.wood > this.stone * threshold && this.wood > this.metal * threshold ) return await this.sellResource( "wood", this.woodincome, await this.getPrice( "wood" ) );
		if( this.stone > this.food * threshold && this.stone > this.wood * threshold && this.stone > this.metal * threshold ) return await this.sellResource( "stone", this.stoneincome, await this.getPrice( "stone" ) );
		if( this.metal > this.food * threshold && this.metal > this.wood * threshold && this.metal > this.stone * threshold ) return await this.sellResource( "metal", this.metalincome, await this.getPrice( "metal" ) );
		
		let best = "";
		let markets = await this.database.get( "SELECT * FROM market WHERE roundid = " + this.currentRound );
		for( var m in markets ) {
			markets[ m ].ratio = await this.getProductionRatio( markets[ m ].type );			
			if( markets[ m ].ratio >= 1 ) {
				markets[ m ].price = parseFloat( markets[ m ].price );
				markets[ m ].profit = markets[ m ].ratio * markets[ m ].price;
				
				let quantity = $val ? Math.ceil( $val / markets[ m ].price ) : this[ markets[ m ].type + "income" ];
				if( this[ markets[ m ].type ] < quantity ) continue;
								
				if( !best || ( ( markets[ m ].profit > best.profit ) || ( markets[ m ].profit == best.profit && markets[ m ].ratio > best.ratio ) ) )
					best = markets[ m ];							
			} 
		}
		
		if( best ) {			
			let quantity = $val ? Math.ceil( $val / best.price ) : this[ best.type + "income" ];
			quantity = quantity > this[ best.type ] ? parseInt( this[ best.type ] ) : parseInt( quantity );			
			
			if( ( quantity > 0 ) && ( this[ best.type ] - quantity >= this[ best.type + "upkeep" ] * 2 ) ) {				
				if( quantity > 0 )
					return await this.sellResource( best.type, quantity, best.price );
			}
		}
		
		return false;
	}
	
	async needGold( $val ) {		
		this.debug( "needGold" );
		
		let result = await this.sellForGold( $val );
		if( result ) return result;
		
		return await super.needGold();
	}
	
	async needFood( $val ) {
		this.debug( "needFood", false, true );
		
		let data = await this.database.getOne( "SELECT * FROM market WHERE type = 'food' AND roundid = " + this.currentRound );
		let available = data.total_sold - data.total_bought;
		if( available <= 0 ) {
			//None for sale, just fallback
			this.debug( "No Food Available", false, true );
			let result = await super.needFood();			
			return result;
		} else {
			this.debug( "Food For Sale: " + data.price + " -- " + ( this.goldincome / this.foodincome ) );
			if( data.price > this.goldincome / this.foodincome ) {
				this.debug( "Food not buyable", false, true );
				return await super.needFood();
			} else {				
				let quantity = available > $val ? $val : available;
				if( this.gold > Math.ceil( quantity * data.price ) ) {					
					return await this.buyResource( "food", quantity, data.price );
				}
				else return await this.needGold( Math.ceil( quantity * data.price ) - this.gold );
			}
		}
	}
	
	async needStone( $val ) {
		this.debug( "needStone", false, true );
		
		let data = await this.database.getOne( "SELECT * FROM market WHERE type = 'stone' AND roundid = " + this.currentRound );
		let available = data.total_sold - data.total_bought;
		if( available <= 0 ) {
			//None for sale, just fallback
			this.debug( "No Stone Available", false, true );
			return await super.needStone();
		} else {
			this.debug( "Stone For Sale: " + data.price + " -- " + ( this.goldincome / this.stoneincome ) );
			if( data.price > ( this.goldincome / this.stoneincome ) ) {
				this.debug( "Stone not buyable", false, true );
				return await super.needStone();
			} else {
				let quantity = available > $val ? $val : available;				
				if( this.gold > Math.ceil( quantity * data.price ) ) {					
					return await this.buyResource( "stone", quantity, data.price );
				}
				else return await this.needGold( Math.ceil( quantity * data.price ) - this.gold );
			}
		}
	}	
	
	async needWood( $val ) {
		this.debug( "needWood", false, true );
		
		let data = await this.database.getOne( "SELECT * FROM market WHERE type = 'wood' AND roundid = " + this.currentRound );
		let available = data.total_sold - data.total_bought;
		this.debug( "Wood Available: " + available );
		if( available <= 0 ) {
			//None for sale, just fallback
			this.debug( "No Wood Available", false, true );
			return await super.needWood();
		} else {
			this.debug( "Wood For Sale: " + data.price + " -- " + ( this.goldincome / this.woodincome ) );
			if( data.price > this.goldincome / this.woodincome ) {
				this.debug( "Wood not buyable" );
				return await super.needWood();
			} else {				
				let quantity = available > $val ? $val : available;				
				this.debug( "Buying Wood", false, true );
				if( this.gold > Math.ceil( quantity * data.price ) ){							
					return await this.buyResource( "wood", quantity, data.price );				
				}
				else return await this.needGold( Math.ceil( quantity * data.price ) - this.gold );				
			}
		}
	}
	
	debug( $msg, $force ) {
		if( this._debug || $force )
			Logger.logBot( "MarketBot(" + this.id + "): " + $msg );			
	}
}

module.exports = MarketBot;