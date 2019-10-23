var	colors = require('colors');
var Logger = require( './logger' );
var JobReward = require( './job-reward' );
var	EventEmitter = require("events").EventEmitter;

class JobRewardManager extends EventEmitter {	
	constructor() {
		super();
		this.debug( "Created" );			
	}	

	static set database( $db ) {	
		this.debug( "Set Database" );
		
		this._database = $db;
		this.loadRewards();			
	}	
	
	static onRewardsUpdated() {
		this.debug( "onRewardsUpdated" );
		this.loadRewards();
	}
	
	static async loadRewards() {
		this.debug( "loadRewards" );
		
		if( this._database ) {
			const rewards = await this._database.get( "SELECT id FROM job_rewards" );
			
			let rewardsByID = [];			
			let reward;
			for( let i in rewards ) {
				reward = new JobReward( rewards[ i ].id, this._database );
				await reward.load();
				
				rewardsByID[ reward.id ] = reward;				
			}					
			
			this.rewardsByID = rewardsByID;
			this.rewardsByType = rewardsByType;
		}
	}	
	
	static Update() {
		this.debug( "Update" );
		this.loadRewards();
	}
	
	static getRewardByID( $reward ) {
		if( this.rewardsByID[ $reward ] )
			return this.rewardsByID[ $reward ].clone();
	}
	
	static debug( $msg ) {
		Logger.logServer( "JobRewardManager: " + $msg );
	}
}

module.exports = JobRewardManager;