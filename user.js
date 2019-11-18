var util = require("util");
var	EventEmitter = require("events").EventEmitter;
var	guid = require('uuid');
var validator = require('validator');
var Logger = require( './logger' );
var bcrypt = require( 'bcrypt' );
var UnitManager = require ( './unit-manager' );
var ItemManager = require( './item-manager' );
let Combat = require( './combat' );

class User extends EventEmitter {
	constructor() {
		super();
		this._debug = true;
	}

	//==========================//
	//	Account Methods			//
	//==========================//
	async login( $username, $password, $token, $os ) {
		this.debug( "login: " + $username + " :: " + $token + " ::: " + $os );
		
		$username = this.validateString( $username );
		$password = this.validateString( $password );			
		
		const data = await this.database.getOne( "SELECT id, password, username FROM users WHERE BINARY username = '" + $username + "' LIMIT 1" );
		if( !data ) return this.dispatch( "LOGIN_FAIL" );
						
		//We have a user, now compare the hashed password
		const compare = await bcrypt.compare( $password, data.password );
		if( compare ) {
			//We're valid!  Process login and record
			this.id = data.id;
			this.username = data.username;			
			
			this.jobThrottleTime = 3600; //Hourly
			this.jobThrottleAmount = 5;	
	
			this.log( "Logged In: " + this.connection.handshake.headers[ 'x-real-ip' ] );
			//this.logIP( this.connection.handshake.headers[ 'x-real-ip' ] );
			
			const loginQuery = "UPDATE users SET last_login = UNIX_TIMESTAMP(), last_seen = UNIX_TIMESTAMP() WHERE id = " + this.id;
			const connection = await this.database.beginTransaction();			
			const result = await connection.query( loginQuery );			
			if( !result || result[ 0 ].affectedRows != 1 ) {
				await this.database.rollback( connection );
				Logger.logError( "Error Updating Login: " + loginQuery );
			} else await this.database.commit( connection );
			
			const banQuery = "SELECT id, reason, until AS perma, ( until - UNIX_TIMESTAMP() ) AS until FROM users_bans WHERE userid = " + this.id + " AND ( until > UNIX_TIMESTAMP() OR until = -1) LIMIT 1";
			console.log( banQuery );
			const ban = await this.database.get( banQuery );
			if( ban && ban.length >= 1 ) {
				console.log( "WE R BANNED WHAT" );
				this.dispatch( "LOGIN_BAN", { reason:ban.reason, until:( ban.perma !== -1 ? ban.until : "perma" ) } );
				return this.dispatch( "LOGIN_FAIL" );
			}

			await this.checkForBannedDupes();
			
			const tokenQuery = "SELECT id FROM users_push_tokens WHERE userid = " + this.id + " AND token = '" + $token + "' LIMIT 1";
			let tokenResult = await this.database.getOne( tokenQuery );
			if( !tokenResult ) {				
				let insertResult = await this.database.execute( "INSERT INTO users_push_tokens SET userid = " + this.id + ", os = '" + $os + "', token = '" + $token + "', date = UNIX_TIMESTAMP()" );								
				if( insertResult && insertResult.affectedRows == 1 ) {									
					await this.checkForTokenDupes( $token );
				}
			}
			
			this.load();
		} else this.dispatch( "LOGIN_FAIL" );
	}

	async logout() {
		this.debug( "logout" );

		this.saveSnapshot();
		
		const connection = await this.database.beginTransaction();
		const query = "UPDATE users SET last_seen = UNIX_TIMESTAMP() WHERE id = " + this.id + " LIMIT 1";
		const result = await connection.query( query );
		if( !result || result[ 0 ].affectedRows != 1 ) {
			await this.database.rollback( connection );
			Logger.logError( "Error Logging Out: " + query );
		} else await this.database.commit( connection );			

		this.log( "Logged out" );
		this.dispatch( "LOGGED_OUT" );
	}

	async changeEmail( $password, $email ) {
		this.debug( "changeEmail: " + $email + "::" + $password );

		//Validate and sanitize inputs
		$email = this.validateString( $email );
		$password = this.validateString( $password );

		if( !$email ) return this.dispatch( "ERROR", "Missing Email" );
		if( !$password ) return this.dispatch( "ERROR", "Missing Password" );
		
		const userQuery = "SELECT password FROM users WHERE id = " + this.id + " LIMIT 1";
		const updateQuery = "UPDATE users SET email = '" + $email + "' WHERE id = " + this.id;
		
		const check = await this.database.getOne( userQuery );
		if( !check ) return this.dispatchError( "User not found" );
		
		const password = await bcrypt.compare( $password, check.password );
		if( !password ) return this.dispatchError( "Invalid passworod" );
		
		const connection = await this.database.beginTransaction();
		const result = await connection.query( updateQuery );
		if( !result || result[ 0 ].affectedRows != 1 ) {		
			await this.database.rollback( connection );
			
			Logger.logError( "Error Updating Email: " + updateQuery );
			return this.dispatchError( "Error updating email" );
		}
		
		await this.database.commit( connection );			
		this.dispatch( "EMAIL_CHANGED" );
	}

	async changePassword( $oldPassword, $newPassword ) {
		this.debug( "changePassword: " + $oldPassword + "::" + $newPassword );

		//Validate the input
		$oldPassword = this.validateString( $oldPassword );
		$newPassword = this.validateString( $newPassword );

		if( !$oldPassword ) return this.dispatch( "ERROR", "Missing Current Password" );
		if( !$newPassword ) return this.dispatch( "ERROR", "Missing New Password" );
		
		var userQuery = "SELECT password FROM users WHERE id = " + this.id + " LIMIT 1";
		let result = await this.database.getOne( userQuery );		
		if( !result ) return this.dispatchError( "User not found" );
				
		result = await bcrypt.compare( $oldPassword, result.password );			
		if( result ) return this.dispatchError( "Invalid password" );
		
		const salt = await bcrypt.genSalt( 5 );
		const hash = await bcrypt.hash( $newPassword, salt );				
		
		const query = "UPDATE users SET password = '" + hash + "' WHERE id = " + this.id;
		const connection = await this.database.beginTransaction();
		result = await connection.query( query )
		if( !result || result[ 0 ].affectedRows != 1 ) {
			await this.database.rollback( connection );			
			return this.dispatchError( "Error changing password" );
		}
		
		await this.database.commit( connection );
		this.dispatch( "PASSWORD_CHANGED" );
	}

	//==========================//
	//	Dupe Check Methods		//
	//==========================//
	async checkForBannedDupes() {
		this.debug( "checkForBannedDupes" );
		
		const query = "SELECT username from users_dupes INNER JOIN users ON users.id = dupe WHERE userid = " + this.id + " AND banned = 1 AND type = 2 ORDER BY users.id";
		const result = await this.database.getOne( query );
		if( result ) {
			console.log( "FOUND BANNED DUPE: " + result.username );
		}
	}
	
	async checkForTokenDupes( $token ) {
		//Make sure it's not the default or empty token
		if( !$token || $token === "---" || $token === "" ) return;
		
		this.debug( "checkForTokenDupes: " + $token );
		
		const query = "SELECT userid FROM users_push_tokens WHERE token = '" + $token + "' AND userid <> " + this.id;
		const results = await this.database.get( query );
		for( let r in results ) {			
			await this.markDupes( this.id, results[ r ].userid, 2 );						
		}		
	}
	
	async recordDupe( $p1, $p2, $type, $connection ) {
		this.debug( "recordDupe: " + $p1 + ":" + $p2 + ":" + $type );
		
		let query = "SELECT id FROM users_dupes WHERE userid = " + $p1 + " AND dupe = " + $p2 + " AND type = " + $type;		
		let result = await $connection.query( query );
		
		//This has already been recorded, no need to continue
		if( result[ 0 ][ 0 ] ) return true;
				
		//Insert the dupe
		query = "INSERT INTO users_dupes SET userid = " + $p1 + ", dupe = " + $p2 + ", type = " + $type + ", time = UNIX_TIMESTAMP()";		
		result = await $connection.query( query );
		if( !result || result[ 0 ].affectedRows != 1 ) {
			Logger.logError( "Error Marking Dupe: " + $p1 + " and " + $p2 + " of type " + $type );
			return false;
		}			
		
		//Grab the other username
		let dupe = await $connection.query( "SELECT username FROM users WHERE id = " + $p2 );
		dupe = dupe[ 0 ][ 0 ].username;
		
		//Insert record into action log
		query = "INSERT INTO users_log SET userid = " + $p1 + ", roundid = 0, action = 'Marked as duplicate of " + dupe + "', time = UNIX_TIMESTAMP()";
		result = await $connection.query( query );
		console.log( result[ 0 ].affectedRows );
		if( !result || !result[ 0 ] || !result[ 0 ].affectedRows ) {
			return false;
		}
		
		//See if the other user is banned		
		query = "SELECT * FROM ( SELECT banned AS self FROM users WHERE id = 2 ) AS T1 INNER JOIN ( SELECT banned AS other FROM users WHERE id = 3 ) AS T2";
		result = await this.database.getOne( query );
		if( result.other && !result.self ) {
			//Other user is banned, automatically perma ban this user
			result = await this.banUser( this.id, "Duplicate of " + dupe, -1 );
		}
		
		return true;
	}
	
	async banUser( $id, $reason, $length ) {
		this.debug( "banUser: " + $id + ":" + $reason + ":" + $length );
		
		let query = "INSERT INTO users_bans SET userid = " + $id + ", reason = '" + $reason + "', duration = " + $length
		let result = await this.database.execute( query );
		if( result.affectedRows === 0 ) {
			Logger.logError( "Error Recording Ban for: " + $id );
			return;
		}
		
		//Length should be a time in hours, or -1 for perma, convert to minutes if not perma
		if( $length > 0 ) $length = $length * 60 * 60;
		
		query = "UPDATE users SET banned = 1, banned_reason = '" + $reason + "', banned_until = " + ( $length === -1 ? "-1" : "UNIX_TIMESTAMP() + " + $length ) + " WHERE id = " + $id;
		result = await this.database.execute( query );
		if( result.affectedRows === 0 ) {		
			Logger.logError( "Error Banning User: " + $id );
		}
	}
	
	async handleDupeFail( $p1, $p2, $type, $connection ) {
		this.debug( "handleDupeFail: " + $p1 + ":" + $p2 + ":" + $type );
		
		Logger.logError( "Error Marking " + $p1 + " as Dupe of " + $p2 );
		await this.database.rollback( $connection );
	}
	
	async markDupes( $p1, $p2, $type ) {
		this.debug( "markDupe: " + $p1 + ":" + $p2 + ":" + $type );
		
		//Create the connection
		const connection = await this.database.beginTransaction();
		
		//Mark the first dupe, if failed bail out
		let result = await this.recordDupe( $p1, $p2, $type, connection );
		if( !result ) return this.handleDupeFail( $p1, $p2, $type, connection );
		
		//Handle the second dupe, if failed bail out
		result = await this.recordDupe( $p2, $p1, $type, connection );
		if( !result ) return this.handleDupeFail( $p2, $p1, $type, connection );
		
		//Commit the data to the database
		await this.database.commit( connection );		
	}
	
	//==========================//
	//	Round Methods			//
	//==========================//
	async joinRound( $rid ) {
		this.debug( "joinRound: " + $rid );

		if( !$rid || $rid <= 0 ) return this.dispatch( "ERROR", "Invalid Round" );
		
		const roundQuery = "SELECT * FROM rounds WHERE id = " + $rid;
		const updateQuery = "UPDATE users SET current_round = " + $rid + " WHERE id = " + this.id;
		const checkQuery = "SELECT id FROM users_rounds WHERE roundid = " + $rid + " AND userid = " + this.id;

		//Save current snapshot before switching rounds
		if( !this.bot ) this.saveSnapshot();

		const round = await this.database.getOne( roundQuery );
		if( !round ) return this.dispatchError( "Round not found" );
		if( !round.active ) return this.dispatchError( "Round Not Active" );
		
		const checkResults = await this.database.getOne( checkQuery );
		if( checkResults ) return this.playRound( $rid );
	
		const connection = await this.database.beginTransaction();
		const insertQuery = "INSERT INTO users_rounds SET userid = " + this.id + ", roundid = " + round.id + ", land = " + round.land + ", land_free = " + round.land + ", gold = " + round.gold + ", food = " + round.food + ", wood = " + round.wood + ", stone = " + round.stone + ", metal = " + round.metal + ", energy = " + round.max_energy + ", active = 1";
		
		let result;
		try {
			result = await connection.query( insertQuery );
			if( !result || result[ 0 ].affectedRows != 1 ) {
				await this.database.rollback( connection );
				
				Logger.logError( "Error Joining Round: " + insertQuery );
				return this.dispatchError( "Error joining round" );
			}
		} catch( err ) {
			await this.database.rollback( connection );			
			return this.dispatchError( "Error joining round" );//this.joinRound( $rid );
		}
		
		result = await connection.query( updateQuery )		
		if( !result || result[ 0 ].affectedRows != 1 ) {
			await this.database.rollback( connection );
			
			Logger.logError( "Error Joining Round: " + updateQuery );
			return this.dispatchError( "Error joining round" );
		}
		
		connection.commit();
		
		var round1 = await this.database.getOne( "SELECT current_round FROM users WHERE id = " + this.id );
		console.log( "User Round: " + round1.current_round );
		
		this.load( "ROUND_JOINED" );
		this.land = round.land;
		await this.calculatePower( this.id, round.id );
		this.updateDeltas();
				
		let rankQuery = "SELECT MAX(rank) AS rank FROM rankings WHERE roundid = " + round.id + " AND power >= " + this.power;		
		let rankResult = await this.database.getOne( rankQuery );
		if( rankResult ) {
			rankQuery = "INSERT INTO rankings SET rank = " + ( rankResult.rank + 1 ) + ", roundid = " + round.id + ", userid = " + this.id + ", power = " + this.power + ", land = " + this.land;
			result = await connection.query( rankQuery );
			if( !result || result[ 0 ].affectedRows != 1 ) {
				await this.database.rollback( connection );
				
				Logger.logError( "Error Joining Round: " + rankQuery );
				return this.dispatchError( "Error joining round" );
			}			
		} else {
			rankQuery = "SELECT MAX(rank) AS rank FROM rankings WHERE roundid = " + round.id;
			rankResult = await this.database.getOne( rankQuery );
			if( rankResult ) {				
				rankQuery = "INSERT INTO rankings SET rank = " + ( result.rank + 1 ) + ", roundid = " + round.id + ", userid = " + this.id + ", power = " + this.power + ", land = " + this.land;
				result = await connection.query( rankQuery );
				if( !result || result[ 0 ].affectedRows != 1 ) {
					await this.database.rollback( connection );
					
					Logger.logError( "Error Joining Round: " + rankQuery );
					return this.dispatchError( "Error joining round" );
				}				
			} else {
				Logger.logError( "Error Joining Round: " + rankQuery );
			}
		}
		
		await this.database.commit( connection );
	}

	async playRound( $rid ) {
		this.debug( "playRound: " + $rid );

		if( !$rid || $rid <= 0 ) return this.dispatch( "ERROR", "Invalid Round" );
		
		var roundQuery = "SELECT active FROM rounds WHERE id = " + $rid;
		var updateQuery = "UPDATE users SET current_round = " + $rid + " WHERE id = " + this.id;
		var checkQuery = "SELECT id FROM users_rounds WHERE userid = " + this.id + " AND roundid = " + $rid;

		//Save snapshot for current round
		this.saveSnapshot()

		const round = await this.database.getOne( roundQuery );
		if( round ) {
			if( round.active ) {
				const check = await this.database.getOne( checkQuery );
				if( check ) {
					const connection = await this.database.beginTransaction();
					const result = await connection.query( updateQuery );
					if( result && result[ 0 ].affectedRows == 1 ) {
						await this.database.commit( connection );
						
						this.load( "ROUND_SWITCHED" );
					} else {
						await this.database.rollback( connection )						
						Logger.logError( "Error Switching Round: " + updateQuery );
						this.dispatchError( "Error switching round" );
					}
				} else {
					this.joinRound( $rid );
				}
			} else this.dispatchError( "Round not active" );
		} else this.dispatchError( "Round not found" );
	}

	async getRounds() {
		this.debug( "getRounds" );
		
		var query = "SELECT rounds.id, rounds.energy, rounds.max_energy, IF( roundid IS NOT NULL, 1, 0 ) AS playing FROM rounds LEFT JOIN ( SELECT id, roundid FROM users_rounds WHERE userid = " + this.id + " ) as u ON rounds.id = u.roundid WHERE active = 1";
		
		const rounds = await this.database.get( query );
		if( rounds ) this.dispatch( "ROUND_LIST", rounds );		
	}

	async getFinishedRounds( page ) {
		this.debug( "getPastRounds: " + page );
		if( !page || page < 0 ) {
			Logger.logError( "getPastRounds: Invalid page: " + page );
			return this.dispatchError( "Error Retrieving Finished Rounds" );
		}
		
		const perPage = 10;
		const query = "SELECT id FROM rounds WHERE active = 0 ORDER BY expires DESC LIMIT " + ( ( page - 1 ) * perPage ) + "," + perPage;
		console.log( query );
		const rounds = await this.database.get( query );
		console.log( rounds );

		this.dispatch( "FINISHED_ROUND_LIST", { test:"123" } );
	}

	async getSummary() {
		this.debug( "getSummary" );

		var data = {};
		
		const eventQuery = "SELECT COUNT(id) AS count FROM events WHERE roundid = " + this.currentRound + " AND userid = " + this.id + " AND unread = 1";
		let results = await this.database.getOne( eventQuery );
		if( results ) data.events = results.count;
		else data.events = 0;			
		
		const snapshotQuery = "SELECT snapshot FROM users_rounds WHERE roundid = " + this.currentRound + " AND userid = " + this.id;		
		results = await this.database.getOne( snapshotQuery );
		if( !results || !results.snapshot ) { results = {}; results.snapshot = "{}"; }		
		data.snapshot = Buffer.from( results.snapshot ).toString( "base64" );
		
		this.dispatch( "GET_SUMMARY", data );			
	}

	async saveSnapshot() {
		this.debug( "saveSnapshot" );

		if( this.currentRound ) {
			var data = {};
			data.land = Math.floor( this.land );
			data.gold = Math.floor( this.gold );
			data.food = Math.floor( this.food );
			data.wood = Math.floor( this.wood );
			data.stone = Math.floor( this.stone );

			data.units = this.units;
			data.buildings = this.buildings;

			const query = "UPDATE users_rounds SET snapshot = '" + JSON.stringify( data ) + "' WHERE userid = " + this.id + " AND roundid = " + this.currentRound;
			const connection = await this.database.beginTransaction();
			const result = await connection.query( query );
			if( !result || result[ 0 ].affectedRows != 1 ) {
				await this.database.rollback( connection );
				Logger.logError( "Error Saving Snapshot: " + query );
			} else await this.database.commit( connection );
		}

		return this;
	}

	//==========================//
	//	Logging Methods			//
	//==========================//
	async log( $action, $round ) {
		const query = "INSERT INTO users_log SET userid = " + this.id + ( $round ? ", roundid = " + this.currentRound : "" ) + ", action = '" + validator.unescape( $action ) + "', time = UNIX_TIMESTAMP()";
		const connection = await this.database.beginTransaction();
		
		try {
			const result = await connection.query( query );
			if( !result || result[ 0 ].affectedRows != 1 ) {
				await this.database.rollback( connection );
				Logger.logError( "Error Logging: " + query );
			} else await this.database.commit( connection );
		} catch( err ) {
			Logger.logError( "Error Logging: " + err );
		}
	}

	async logDupe( $dupe, $type ) {
		this.debug( "logDupe" );	

		let connection = await this.database.beginTransaction();
		let query = "";
		let result;
		
		//Insert the Duplicate record for both sides of the match
		let check = await this.database.getOne( "SELECT id FROM users_dupes WHERE userid = " + this.id + " AND dupe = " + $dupe.userid + " AND type = " + $type );
		if( !check ) {			
			query = "INSERT INTO users_dupes SET userid = " + this.id + ", dupe = " + $dupe.userid + ", type = " + $type + ", time = UNIX_TIMESTAMP()";
			result = await connection.query( query );
			if( !result || result[ 0 ].affectedRows != 1 ) {
				Logger.logError( "Error Inserting Dupe: " + query );
			}			
			this.log( "Marked as Duplicate of " + dupe.username );
		}
		
		check = await this.database.getOne( "SELECT id FROM users_dupes WHERE userid = " + $dupe.userid + " AND dupe = " + this.id + " AND type = " + $type );
		if( !check ) {
			query = "INSERT INTO users_dupes SET userid = " + $dupe.userid + ", dupe = " + this.id + ", type = " + $type + ", time = UNIX_TIMESTAMP()";
			result = await connection.query( query );
			if( !result || result[ 0 ].affectedRows != 1 ) {
				Logger.logError( "Error Inserting Dupe: " + query );
			}
			
			query = "INSERT INTO users_log SET userid = " + $dupe.userid + ", action = 'Marked as Duplicate of " + validator.unescape( this.username ) + "', time = UNIX_TIMESTAMP()";
			result = await connection.query( query );
			if( !result || result[ 0 ].affectedRows != 1 ) {
				Logger.logError( "Error Inserting Dupe: " + query );
			}
		}
		
		await this.database.commit( connection );
	}

	async logIP( $ip ) {
		//See if we've already logged this IP
		const checkIP = await this.database.getOne( "SELECT id FROM users_ips WHERE userid = " + this.id + " AND ip = '" + $ip + "' LIMIT 1" );
		if( !checkIP ) {
			//It's new!  Let's record it and then check for dupes
			const connection = await this.database.beginTransaction();
			const query = "INSERT INTO users_ips SET userid = " + this.id + ", ip = '" + $ip + "'";
			const result = await connection.query( query );
			if( !result || result[ 0 ].affectedRows != 1 ) {
				await this.database.rollback( connection );
				
				Logger.logError( "Error Logging IP: " + query );
			} else await this.database.commit( connection );			
			
			const dupes = this.database.get( "SELECT userid, username FROM users_ips INNER JOIN users ON users.id = userid WHERE userid <> " + this.id + " AND ip = '" + $ip + "'" );
			if( dupes ) {
				for( dupe in dupes ) {
					this.logDupe( dupes[ dupe ], 1 );
				}
			}
		}		
	}

	async logenergy( $type, $amount ) {
		this.debug( "logenergy: " + $type + ":" + $amount );

		try {
			const query = "INSERT INTO metric_energy_log SET userid = " + this.id + ", roundid = " + this.currentRound + ", type = '" + $type + "', amount = " + $amount + ", time = UNIX_TIMESTAMP()";
			const connection = await this.database.beginTransaction();
			
			const result = await connection.query( query );
			if( !result || result[ 0 ].affectedRows != 1 ) {
				await this.database.rollback( connection );
				Logger.logError( "Error Logging energy: " + query );
			} else await this.database.commit( connection );
		} catch( err ) {
			Logger.logError( "logenergy: " + err );
		}
	}

	async logEvent( $evt, $round, $icon ) {
		this.debug( "logEvent: " + $round + " : " + $icon + " : " + $evt );

		//Store the event
		const query = "INSERT INTO events SET userid = " + this.id + ", roundid = " + $round + ", icon = '" + $icon + "', event = '" + $evt + ", time = UNIX_TIMESTAMP()";		
		const connection = await this.database.beginTransaction();
		const result = await connection.query( query );
		if( !result || result[ 0 ].affectedRows != 1 ) {
			await this.database.rollback( connection );
			Logger.logError( "Error Logging Event: " + query );
		} else await this.database.commit( connection );		
	}

	//====================//
	//	Methods						//
	//====================//
	async load( $evt, $round, $callback ) {
		this.debug( "load: " + ( $round ? $round : this.currentRound ) );

		if( !$evt ) $evt = "LOGIN_SUCCESS";
			
		let data = await this.database.getOne( "SELECT username, email, current_round, avatar, gems, sex, users_bots.type AS bot, banned, banned_reason, banned_until FROM users LEFT JOIN users_bots ON users_bots.userid = users.id WHERE users.id = " + this.id + " LIMIT 1" );
		if( !data ) {
			Logger.logError( "User Not Found: " + this.id );
			return this.dispatch( "LOGIN_FAIL" );
		}

		this.username = data.username;
		this.email = data.email;
		this.currentRound = $round ? $round : data.current_round;
		this.avatar = data.avatar;
		this.gems = data.gems;
		this.sex = data.sex;
		
		//Save ban state before updating
		let bannedCheck = this.banned;
		this.banned = data.banned;
		this.bannedReason = data.banned_reason;
		this.bannedUntil = data.banned_until;
		
		//See if banned state has changed
		if( !bannedCheck && this.banned ) {
			let data = {};
			data.reason = this.bannedReason;
			data.duration = this.bannedUntil > 0 ? this.bannedUntil - ( new Date().getTime() / 1000 ) : this.bannedUntil;
			
			//Dispatch Banned event
			this.dispatch( "BANNED", data );
			return;
		}

		if( this.currentRound ) {
			data = await this.database.getOne( "SELECT * FROM users_rounds WHERE userid = " + this.id + " AND roundid = " + this.currentRound );			
			if( data ) {
				console.log( "-----------------------" );
				console.log( data );
				console.log( "-----------------------" );

				//Store the values in our current object
				this.gold = parseFloat( data.gold );
				this.land = parseFloat( data.land );
				this.landFree = parseFloat( data.land_free );
				this.food = parseFloat( data.food );
				this.mana = parseFloat( data.mana );
				this.wood = parseFloat( data.wood );
				this.metal = parseFloat( data.metal );
				console.log( "METAL: " + this.metal );
				this.stone = parseFloat( data.stone );
				this.faith = parseFloat( data.faith );
				this.energy = parseInt( data.energy );
				this.power = data.power;
				this.foodtick = data.food_income - data.food_upkeep;
				this.foodIncome = data.food_income;
				this.foodUpkeep = data.food_upkeep;
				this.goldtick = data.gold_income - data.gold_upkeep;
				this.stonetick = data.stone_income - data.stone_upkeep;
				this.faithtick = data.faith_income - data.faith_upkeep;
				this.manatick = data.mana_income - data.mana_upkeep;
				this.woodtick = data.wood_income - data.wood_upkeep;
				this.metaltick = data.metal_income - data.metal_upkeep;
				this.population = data.population;
				this.population_max = data.population_max;
				this.buildPower = data.build;
				this.defensePower = data.defense;
				this.recruitPower = data.recruit;

				//Create the packet for the client
				data = {};
				data.user = {};
				data.user.username = this.username;
				data.user.email = this.email;
				data.user.currentRound = this.currentRound;
				data.user.avatar = this.avatar;
				data.user.gems = this.gems;
				data.user.population = Math.floor( this.population );
				data.user.populationMax = Math.floor( this.population_max );
				data.user.gold = Math.floor( this.gold );
				data.user.land = Math.floor( this.land );
				data.user.food = Math.floor( this.food );
				data.user.mana = Math.floor( this.mana );
				data.user.metal = Math.floor( this.metal );
				data.user.stone = Math.floor( this.stone );
				data.user.wood = Math.floor( this.wood );
				data.user.faith = Math.floor( this.faith );
				data.user.energy = Math.floor( this.energy );
				data.user.power = Math.floor( this.power );
				data.user.foodtick = Math.floor( this.foodtick );
				data.user.goldtick = Math.floor( this.goldtick );
				data.user.stonetick = Math.floor( this.stonetick );
				data.user.faithtick = Math.floor( this.faithtick );
				data.user.woodtick = Math.floor( this.woodtick );
				data.user.metaltick = Math.floor( this.metaltick );
				data.user.manatick = Math.floor( this.manatick );
				data.user.build = Math.floor( this.buildPower );
				data.user.recruit = Math.floor( this.recruitPower );
				data.user.defense = Math.floor( this.defensePower );				

				data.user.buildings = [];				
				const buildings = await this.database.get( "SELECT quantity, type FROM users_rounds_buildings INNER JOIN buildings ON buildingid = buildings.id WHERE userid = " + this.id + " AND roundid = " + this.currentRound + " ORDER BY quantity DESC" );
				for( var b in buildings ) {
					data.user.buildings[ b ] = 1;
					data.user.buildings[ buildings[ b ].type ] = buildings[ b ].quantity;
				}
				data.user.buildings = Buffer.from( JSON.stringify( data.user.buildings ) ).toString( "base64" );				
				
				data.user.units = {};
				const units = await this.database.get( "SELECT quantity, type FROM users_rounds_units INNER JOIN units ON units.id = unitid WHERE userid = " + this.id + " AND roundid = " + this.currentRound );
				console.log( "==============================" );
				console.log( "SELECT quantity, type FROM users_rounds_units INNER JOIN units ON units.id = unitid WHERE userid = " + this.id + " AND roundid = " + this.currentRound );
				console.log( units );
				for( var u in units ) {
					data.user.units[ units[ u ].type ] = units[ u ].quantity;
				}
				console.log( data.user.units );
				console.log( JSON.stringify( data.user.units ) );
				console.log( "==============================" );
				data.user.units = Buffer.from( JSON.stringify( data.user.units ) ).toString( "base64" );
				
				let events = await this.database.getOne( "SELECT COUNT(id) AS count FROM events WHERE userid = " + this.id + " AND roundid = " + this.currentRound + " AND unread = 1 AND deleted = 0" );
				data.user.events = events ? events.count : 0;
				
				let mails = await this.database.getOne( "SELECT COUNT(id) AS count FROM mails WHERE recipient = " + this.id + " AND unread = 1 AND recipientview = 1" );
				data.user.mails = mails ? mails.count : 0;

				this.dispatch( "BUILDINGS_BUILT", { buildings:data.user.buildings } ); 
		
				console.log( "==============================" );
				console.log( data );
				console.log( "==============================" );

				if( $callback ) $callback( data );
				this.emit( $evt );				
				this.dispatch( $evt, data );
			} 
		} else {				
			data = {};
			data.user = {};
			data.user.username = this.username;
			data.user.email = this.email;
			data.user.currentRound = this.currentRound;
			data.user.avatar = this.avatar;
			data.user.gems = this.gems;

			this.emit( $evt );
			this.dispatch( $evt, data );
		}		
	}

	async update( expired ) {
		this.debug( "update" );
		
		try {
			if( this.currentRound ) {
				if( expired && expired.length > 0 ) {
					for( var i = 0; i < expired.length; i++ ) {
						if( this.currentRound == expired[ i ] ) {
							this.debug( "PLAYING EXPIRED ROUND" );
							
							let query = "UPDATE users SET current_round = 0 WHERE id = " + this.id;
							let connection = await this.database.beginTransaction();
							let result = await connection.query( query );
							if( !result || result[ 0 ].affectedRows != 1 ) {
								await this.database.rollback( connection );
								Logger.logError( "Error Reseting User Round: " + query );								
							} else await this.database.commit( connection );
														
							this.dispatch( "ROUND_EXPIRED", {} );
							return;
						}
					}
				}

				let data = await this.database.getOne( "SELECT * FROM users_rounds WHERE userid = " + this.id + " AND roundid = " + this.currentRound );
				if( data ) {
					this.gold = parseFloat( data.gold );
					this.land = parseFloat( data.land );
					this.landFree = parseFloat( data.land_free );
					this.food = parseFloat( data.food );
					this.mana = parseFloat( data.mana );
					this.wood = parseFloat( data.wood );
					this.stone = parseFloat( data.stone );
					this.metal = parseFloat( data.metal );
					this.faith = parseFloat( data.faith );
					this.energy = parseInt( data.energy );
					this.power = data.power;
					this.buildPower = data.build;
					this.defensePower = data.defense;
					this.recruitPower = data.recruit;
					this.populationMax = data.population_max;
					this.population = data.population;

					this.goldtick = data.gold_income - data.gold_upkeep;
					this.woodtick = data.wood_income - data.wood_upkeep;
					this.foodtick = data.food_income - data.food_upkeep;
					this.stonetick = data.stone_income - data.stone_upkeep;
					this.metaltick = data.metal_income - data.metal_upkeep;

					data = {};
					data.gold = Math.floor( this.gold );
					data.land = Math.floor( this.land );
					data.food = Math.floor( this.food );
					data.mana = Math.floor( this.mana );
					data.stone = Math.floor( this.stone );
					data.metal = Math.floor( this.metal );
					data.wood = Math.floor( this.wood );
					data.faith = Math.floor( this.faith );
					data.energy = Math.floor( this.energy );
					data.power = Math.floor( this.power );
					data.build = Math.floor( this.buildPower );
					data.recruit = Math.floor( this.recruitPower );
					data.defense = Math.floor( this.defensePower );
					data.population = Math.floor( this.population );
					data.populationMax = Math.floor( this.populationMax );

					data.goldtick = parseFloat( this.goldtick ).toFixed( 1 );
					data.woodtick = parseFloat( this.woodtick ).toFixed( 1 );
					data.foodtick = parseFloat( this.foodtick ).toFixed( 1 );
					data.stonetick = parseFloat( this.stonetick ).toFixed( 1 );
					data.metaltick = parseFloat( this.metaltick ).toFixed( 1 );
					
					const eventQuery = "SELECT COUNT(id) AS count FROM events WHERE userid = " + this.id + " AND roundid = " + this.currentRound + " AND ( type = 'desert' OR type = 'starvation' ) AND unread = 1 AND time >= UNIX_TIMESTAMP() - 60";
					const events = await this.database.getOne( eventQuery );
					if( events ) data.eventsNew = events.count;
					else data.eventsNew = 0;
					
					console.log( data );
					this.dispatch( "USER_UPDATED", data );
				}
			}
		} catch( err ) {
			Logger.logError( "Error update: " + err );
		}		
	}

	async updateExpenses( connection ) {
		/*this.debug( "updateExpenses" );
		
		var query = "UPDATE users_rounds INNER JOIN ( SELECT userid, roundid, SUM( quantity * upkeep_gold ) as sumGold, SUM( quantity * upkeep_food ) AS sumFood, SUM( quantity * upkeep_faith ) AS sumFaith, SUM( quantity * upkeep_mana ) AS sumMana, SUM( quantity * upkeep_wood ) AS sumWood, SUM( quantity * upkeep_stone ) AS sumStone FROM users_rounds_units INNER JOIN units ON unitid = units.id WHERE userid = " + this.id + " AND roundid = " + this.currentRound + " GROUP BY userid, roundid ) AS s ON s.userid = users_rounds.userid SET users_rounds.gold_upkeep = s.sumGold, users_rounds.food_upkeep = if( s.sumFood, s.sumFood + ( population * .8 ), population * .8 ), users_rounds.stone_upkeep = s.sumStone, users_rounds.wood_upkeep = s.sumWood, users_rounds.faith_upkeep = s.sumFaith, users_rounds.mana_upkeep = s.sumMana WHERE users_rounds.userid = " + this.id + " AND users_rounds.roundid = " + this.currentRound;
		const connection = await this.database.beginTransaction();
		const results = await connection.query( query );
		if( !results || results[ 0 ].affectedRows != 1 ) {
			await this.database.rollback( connection );
			
			Logger.logError( "Error Updating Expenses: " + query );
		}
		
		await this.database.commit( connection );*/
		
		var query = "UPDATE users_rounds INNER JOIN ( SELECT userid, roundid, SUM( quantity * upkeep_gold ) as sumGold, SUM( quantity * upkeep_food ) AS sumFood, SUM( quantity * upkeep_faith ) AS sumFaith, SUM( quantity * upkeep_mana ) AS sumMana, SUM( quantity * upkeep_wood ) AS sumWood, SUM( quantity * upkeep_stone ) AS sumStone FROM users_rounds_units INNER JOIN units ON unitid = units.id WHERE userid = " + this.id + " AND roundid = " + this.currentRound + " GROUP BY userid, roundid ) AS s ON s.userid = users_rounds.userid SET users_rounds.gold_upkeep = s.sumGold, users_rounds.food_upkeep = if( s.sumFood, s.sumFood + ( population * .8 ), population * .8 ), users_rounds.stone_upkeep = s.sumStone, users_rounds.wood_upkeep = s.sumWood, users_rounds.faith_upkeep = s.sumFaith, users_rounds.mana_upkeep = s.sumMana WHERE users_rounds.userid = " + this.id + " AND users_rounds.roundid = " + this.currentRound;
		const results = await connection.query( query );
		if( !results || results[ 0 ].affectedRows != 1 ) {
			Logger.logError( "Error Updating Expenses: " + query );
			return false;
		}
		
		return true;
	}

	async updateDeltas( user ) {
		if( !user ) user = this.id;
		
		var userQuery = "SELECT land, population FROM users_rounds WHERE userid = " + user + " AND roundid = " + this.currentRound + " LIMIT 1";
		var buildingQuery = "SELECT buildings.field, buildings.bonus, quantity FROM users_rounds_buildings INNER JOIN buildings ON buildings.id = users_rounds_buildings.buildingid WHERE userid = " + user + " AND roundid = " + this.currentRound;
		var unitQuery = "SELECT upkeep_gold AS gold, upkeep_food AS food, quantity FROM users_rounds_units INNER JOIN units ON units.id = unitid WHERE userid = " + user + " AND roundid = " + this.currentRound;
		
		let data = await this.database.getOne( userQuery );
		if( data ) {
			const land = data.land;
			const population = data.population;
			
			var changes = {};
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
			
			const buildings = await this.database.get( buildingQuery )
			if( buildings ) {
				for( var b in buildings ) {
					changes[ buildings[ b ].field ].income += buildings[ b ].quantity * buildings[ b ].bonus;
				}
			}
			
			const units = await this.database.get( unitQuery );
			if( units ) {
				for( var u in units ) {
					changes.food.upkeep += 1 * units[ u ].quantity * units[ u ].food;
					changes.gold.upkeep += 1 * units[ u ].quantity * units[ u ].gold;					
				}
			}
			
			const connection = await this.database.beginTransaction();
			var updateQuery = "UPDATE users_rounds SET defense = " + ( ( changes.defense.income / land ) * 100 ) + ", population_max = " + changes.population.income + ", recruit = " + changes.recruit.income + ", build = " + changes.build.income + ", gold_income = " + changes.gold.income + ", gold_upkeep = " + changes.gold.upkeep + ", metal_income = " + changes.metal.income + ", metal_upkeep = " + changes.metal.upkeep + ", food_income = " + changes.food.income + ", food_upkeep = " + changes.food.upkeep + ", mana_income = " + changes.mana.income + ", mana_upkeep = " + changes.mana.upkeep + ", faith_income = " + changes.faith.income + ", faith_upkeep = " + changes.faith.upkeep + ", wood_income = " + changes.wood.income + ", wood_upkeep = " + changes.wood.upkeep + ", stone_income = " + changes.stone.income + ", stone_upkeep = " + changes.stone.upkeep + " WHERE userid = " + user + " AND roundid = " + this.currentRound;
			const result = await connection.query( updateQuery );
			if( result && result[ 0 ].affectedRows == 1 ) {									
				await this.database.commit( connection );					

				if( user == this.id ) {
					this.emit( "UPDATED" );
					this.update();
				}
			} else {
				await this.database.rollback( connection );
				
				Logger.logError( "Error Updating Deltas: " + updateQuery );									
				this.dispatch( "ERROR", "Error updating tick values" );
			}
		}
	}

	async destroyBuildings( $type, $quantity ) {
		this.debug( "destroyBuildings: " + $type + ":" + $quantity );

		var buildingQuery = "SELECT id, name, plural FROM buildings WHERE type = '" + $type + "' LIMIT 1";
		const building = await this.database.getOne( buildingQuery );
		if( building ) {				
			const msg = "Destroyed " + $quantity + " " + ( $quantity != 1 ? building.plural : building.name );
			
			const updateQuery = "UPDATE users_rounds_buildings INNER JOIN buildings ON buildings.id = buildingid SET quantity = quantity - " + $quantity + " WHERE quantity > " + $quantity + " AND userid = " + this.id + " AND roundid = " + this.currentRound + " AND type='" + $type + "'";
			const deleteQuery = "DELETE FROM users_rounds_buildings WHERE quantity = " + $quantity + " AND userid = " + this.id + " AND roundid = " + this.currentRound + " AND buildingid = " + building.id;
			const freeQuery = "UPDATE users_rounds SET land_free = land_free + " + $quantity + " WHERE userid = " + this.id + " AND roundid = " + this.currentRound + " LIMIT 1";						
						
			const connection = await this.database.beginTransaction();			
			
			let result = await connection.query( updateQuery );
			this.debug( "Ran Update" );
			if( !result || result[ 0 ].affectedRows != 1 ) {
				result = await connection.query( deleteQuery );
				this.debug( "Ran Delete" );
				if( !result || result[ 0 ].affectedRows != 1 ) {		
					await this.database.rollback( connection );
					
					Logger.logError( "Delete Query: " + deleteQuery );
					return this.dispatchError( { message: "Error destroying " + $quantity + " " + $type } );
				}
			}
			
			result = await connection.query( freeQuery );
			if( result && result[ 0 ].affectedRows == 1 ) {				
				await this.database.commit( connection );
				
				this.updateDeltas();
				const buildings = await this.database.get( "SELECT quantity, type FROM users_rounds_buildings INNER JOIN buildings ON buildingid = buildings.id WHERE userid = " + this.id + " AND roundid = " + this.currentRound + " ORDER BY quantity DESC" );
				
				var data = {};
				data.user = {};

				if( buildings ) {
					data.user.buildings = {};

					for( var b in buildings )
						data.user.buildings[ buildings[ b ].type ] = buildings[ b ].quantity;
				}

				this.dispatch( "UPDATED", data );
				this.dispatch( "BUILDINGS_DESTROYED", { buildings:data.user.buildings, msg:msg } );
			} else {
				await this.database.rollback( connection );
				
				Logger.logError( "Error Deleting Buildings: " + freeQuery );
			}
		}			
	}

	async fireUnits( $type, $quantity ) {
		this.debug( "fireUnits: " + $type + ":" + $quantity );

		//Validate Input
		$type = this.validateString( $type );
		$quantity = parseInt( $quantity );

		if( !$type ) return this.dispatchError( "Invalid unit" );
		if( $quantity <= 0 ) return this.dispatchError( "Invalid quantity" );
				
		const unit = UnitManager.getUnitByType( $type );
		if( unit ) {
			const msg = "Fired " + $quantity + " " + ( $quantity != 1 ? unit.plural : unit.name );
			const updateQuery = "UPDATE users_rounds_units INNER JOIN units ON units.id = unitid SET quantity = quantity - " + $quantity + " WHERE quantity > " + $quantity + " AND userid = " + this.id + " AND roundid = " + this.currentRound + " AND type='" + $type + "'";
			const deleteQuery = "DELETE FROM users_rounds_units WHERE quantity = " + $quantity + " AND userid = " + this.id + " AND roundid = " + this.currentRound + " AND unitid = " + unit.id;
			
			const connection = await this.database.beginTransaction();
			
			let result = await connection.query( updateQuery );
			if( !result || result[ 0 ].affectedRows != 1 ){
				result = await connection.query( deleteQuery );
				if( !result || result[ 0 ].affectedRows != 1 ) {
					await this.database.rollback( connection );
					
					Logger.logError( "Error Firing Unit: " + deleteQuery );
					return this.dispatchError( "Error firing " + $quantity + " " + $type );
				}
			}
			
			await this.database.commit( connection );
			
			this.updateDeltas();
			const query = "SELECT quantity, type FROM users_rounds_units INNER JOIN units ON units.id = unitid WHERE userid = " + this.id + " AND roundid = " + this.currentRound;
			const units = await this.database.get( query );
			if( units ) {
				let data = {};
				
				for( var u in units )
					data[ units[ u ].type ] = units[ u ].quantity;
				
				this.dispatch( "UNITS_FIRED", { msg:msg, units:data } );
			}
		}		
	}

	async calculatePower( $userid, $roundid ) {		
		//Validate input
		if( !$userid || $userid <= 0 ) $userid = this.id;
		if( !$roundid || $roundid <= 0 ) $roundid = this.currentRound;
		
		this.debug( "calculatePower: " + $userid + " - " + $roundid );
		
		let power = 0;
		
		const armyQuery = "SELECT quantity, attack, defense, ( quantity * ( attack + defense ) ) AS total FROM users_rounds_units INNER JOIN units ON units.id = unitid WHERE userid = " + $userid + " AND roundid = " + $roundid;
		const army = await this.database.get( armyQuery );
		if( army && army.length >= 1 ) {			
			for( var i in army ) 
				power += parseFloat( army[ i ].total );								
		}			
		
		const landQuery = "SELECT land FROM users_rounds WHERE userid = " + $userid + " AND roundid = " + $roundid;		
		const landResult = await this.database.getOne( landQuery );		
		if( landResult ) {
			power += parseFloat( landResult.land * 5 );			
		} else Logger.logError( "NO LAND RESULT" );
		
		if( power == 0 ) {
			Logger.logError( "Recalling Calculate Power" );
			await this.calculatePower( $userid, $roundid );
			return;
		}
		
		this.power = power;
		const updateQuery = "UPDATE users_rounds SET power = " + this.power + " WHERE userid = " + $userid + " AND roundid = " + $roundid + " LIMIT 1";			
		const connection = await this.database.beginTransaction();	
		try {
			const updateResults = await connection.query( updateQuery );
			if( !updateResults || updateResults[ 0 ].affectedRows != 1 ) {
				await this.database.rollback( connection );
				Logger.logError( "Error Updating Power: " + updateQuery );
			} else await this.database.commit( connection );
		} catch( err ) {
			Logger.logError( updateQuery );
		}
	}

	async claimDaily() {
		this.debug( "claimDaily" );
		
		let query = "SELECT * FROM login_bonus WHERE userid = " + this.id + " LIMIT 1";
		let data = await this.database.getOne( query );
		if( data ) {
			if( !data.claimed ) {
				data.level += 1;
				if( data.level > 3 ) data.level = 3;

				var reward = 0;
				switch( data.level ) {
					case 1: reward = 3; break;
					case 2: reward = 5; break;
					case 3: reward = 10; break;
				}

				query = "UPDATE login_bonus SET level = " + data.level + ", claimed = 1 WHERE userid = " + this.id;
				const connection = await this.database.beginTransaction();
				data = await connection.query( query );
				if( data && data[ 0 ].affectedRows == 1 ) {
					query = "UPDATE users SET gems = gems + " + reward + " WHERE id = " + this.id + " LIMIT 1";
					data = await connection.query( query );
					if( data && data[ 0 ].affectedRows == 1 ) {
						await this.database.commit( connection );
						
						var packet = {};
						packet.level = data.level;
						packet.reward = reward;

						this.gems += reward;
						
						this.dispatch( "USER_UPDATED", { gems: this.gems } );
						this.dispatch( "CLAIM_DAILY", packet );
					} else {
						Logger.logError( "Error Claiming Daily: " + query );
						await this.database.rollback( connection );
					}					
				} else {
					await this.database.rollback( connection );
				}							
			}
		} else {
			query = "INSERT INTO login_bonus SET userid = " + this.id + ", level = 0, claimed = 1";		
			let connection = await this.database.beginTransaction();
			let result = await connection.query( query );
			if( !result || result[ 0 ].affectedRows != 1 ) {
				await this.database.rollback( connection );
				Logger.logError( "Error Claiming Daily: " + query );
			} else await this.database.commit( connection );			
		}
	}

	async getItems() {
		this.debug( "getItems" );
		
		const query = "SELECT itemid AS item FROM users_vault WHERE userid = " + this.id;
		const items = await this.database.get( query );
		if( items ) {
			console.log( items );
			this.dispatch( "ITEMS_RETRIEVED", items );
		} else this.debug( "NO ITEMS IN VAULT" );
	}
	
	async useItem( $item ) {
		this.debug( "useItem: " + $item );
		
		let item = ItemManager.getItemByID( $item );
		this.debug( "Have Item" );
		
		let success = false;
		
		if( item.onUse ) {
			this.debug( "Item has onUse" );
			
			let connection = await this.database.beginTransaction();
			this.debug( "Created Connection" );
			
			let query = "";
			eval( item.onUse );
			if( query ) {
				this.debug( "Have Query: " + query );
				let result = await connection.query( query );				
				if( result && result[ 0 ].affectedRows == 1 ) {
					this.log( "Used: " + item.name, this.currentRound );
					this.debug( "Executed Query" );
					
					let deleteQuery = "DELETE FROM users_vault WHERE userid = " + this.id + " AND itemid = " + $item + " LIMIT 1";
					result = await connection.query( deleteQuery );					
					if( result && result[ 0 ].affectedRows == 1 ) {						
						await this.database.commit( connection );
						this.update();
					} else {
						Logger.logError( "Error Deleting Item: " + deleteQuery );
						await this.database.rollback( connection );
					}									
				} else {					
					Logger.logError( "Error Executing: " + query );
					await this.database.rollback( connection );
				}
			} else Logger.logError( "Item Invalid" );

			const itemsQuery = "SELECT itemid AS item FROM users_vault WHERE userid = " + this.id;
			const items = await this.database.get( itemsQuery );
			
			this.dispatch( "ITEM_USED", items );
		} else Logger.logError( "Error: Item #" + $item + " - Has no on use code" );						
	}
	
	async getAvatars() {
		this.debug( "getAvatars" );
		
		const query = "SELECT * FROM avatars WHERE available = 1 AND sex = '" + this.sex + "'";
		const avatars = await this.database.get( query );
		if( avatars ) {
			this.dispatch( "AVATARS_RETRIEVED", avatars );
		} else this.dispatchError( "Error retrieving avatars" );
	}

	async setAvatar( $avatar ) {
		this.debug( "setAvatar: " + $avatar );

		//Validate Input
		$avatar = parseInt( $avatar );
		if( !$avatar || $avatar <= 0 ) return this.dispatch( "ERROR", "Invalid Avatar" );

		const query = "UPDATE users INNER JOIN avatars ON avatars.id = " + $avatar + " SET users.avatar = avatars.path WHERE users.id = " + this.id;
		const connection = await this.database.beginTransaction();
		const result = await connection.query( query );
		if( !result || result[ 0 ].affectedRows != 1 ) {
			await this.database.rollback( connection );
			
			Logger.logError( "Error Setting Avatar: " + query );
			return this.dispatchError( "Error setting avatar" );
		}
		
		await this.database.commit( connection );
		this.dispatch( "AVATAR_CHANGED", { avatar:avatar } );		
	}

	async getEvents( $page, $per ) {
		this.debug( "getEvents: " + $page + ":" + $per );

		//Validate Input
		$page = parseInt( $page );
		$per = parseInt( $per );

		if( !$page || $page <= 0 ) $page = 1;
		if( !$per || $per <= 0 ) $per = 15;

		let data = {};
		const result = await this.database.getOne( "SELECT COUNT(id) AS total FROM events WHERE userid = " + this.id + " AND roundid = " + this.currentRound + " AND deleted = 0" );
		data.pages = result ? result.total / $per : 1;			
		data.page = $page;
		data.total = result ? result.total : 0;
		
		const eventQuery = "SELECT id, event, time, icon, type, unread FROM events WHERE userid = " + this.id + " AND roundid = " + this.currentRound + " AND deleted = 0 ORDER BY id DESC LIMIT " + ( ( $page - 1 ) * $per ) + "," + $per;
		const events = await this.database.get( eventQuery );
		
		data.events = events;
		
		this.dispatch( "EVENTS_RETRIEVED", data );
		
		if( events && events.length > 0 ) {
			let f = events[ 0 ].id;
			let t = events[ events.length - 1 ].id;
			
			let updateQuery = "UPDATE events SET unread = 0 WHERE userid = " + this.id + " AND roundid = " + this.currentRound + " AND( id <= " + f + " AND id >= " + t + " ) AND deleted = 0";
			const connection = await this.database.beginTransaction();
			
			const results = await connection.query( updateQuery );
			if( !result || results[ 0 ].affectedRows < 1 ) await this.database.rollback( connection );
			else await this.database.commit( connection );					
		}
		
		data = {};
		const count = await this.database.getOne( "SELECT COUNT(id) AS count FROM events WHERE userid = " + this.id + " AND roundid = " + this.currentRound + " AND unread = 1 AND deleted = 0" );		
		data.events = count ? count.count : 0;

		this.events = data.events;
		this.dispatch( "USER_UPDATED", data );
	}

	async deleteEvent( $id ) {
		this.debug( "deleteEvent: " + $id );

		//Validate Input
		$id = parseInt( $id );
		if( !$id || $id <= 0 ) return this.dispatch( "ERROR", "Invalid Event" );
		
		const deleteQuery = "UPDATE events SET deleted = 1, unread = 0 WHERE userid = " + this.id + " AND roundid = " + this.currentRound + " AND id = " + $id;	
		const connection = await this.database.beginTransaction();
		const result = await connection.query( deleteQuery );		
		if( !result || result[ 0 ].affectedRows != 1 ) {
			await this.database.rollback( connection );
			
			Logger.logError( "Error Deleting Event: " + deleteQuery );
			return this.dispatchError( "Error deleting event" );
		}	
		
		await this.database.commit( connection );
		this.dispatch( "EVENT_DELETED" );	
	}

	async deleteAllEvents() {
		this.debug( "deleteAllEvents" );
		
		const deleteQuery = "UPDATE events SET deleted = 1, unread = 0 WHERE userid = " + this.id + " AND roundid = " + this.currentRound + " AND deleted = 0";
		const connection = await this.database.beginTransaction();
		const result = await connection.query( deleteQuery );
		
		if( !result || result[ 0 ].affectedRows < 1 ) await this.database.rollback( connection );
		else await this.database.commit( connection );
		
		this.dispatch( "EVENTS_DELETED" );
	}

	async submitContact( $msg ) {
		this.debug( "submitContact: " + $msg );

		//Validate Input
		$msg = this.validateString( $msg );
		if( !$msg ) return this.dispatch( "ERROR", "No Message Entered" );
		
		const msg = Buffer.from( $msg ).toString( "base64" );

		var query = "INSERT INTO contact_submissions SET userid = " + this.id + ", roundid = " + this.currentRound + ", message = '" + msg + "', time = UNIX_TIMESTAMP();";
		const connection = await this.database.beginTransaction();
		const result = await connection.query( query );
		if( !result || result[ 0 ].affectedRows != 1 ) {
			await this.database.rollback( connection );
			Logger.logError( "Error Submitting Contact: " + query );			
		} else await this.database.commit( connection );
		
		this.dispatch( "CONTACT_SUBMITTED" );
	}

	async buyenergy() {
		this.debug( "buyenergy" );
		
		const roundQuery = "SELECT max_energy FROM rounds WHERE id = " + this.currentRound;
		const takeQuery = "UPDATE users SET gems = gems - 25 WHERE id = " + this.id + " AND gems >= 25";
		const userQuery = "SELECT energy, gems FROM users_rounds WHERE userid = " + this.id + " AND roundid = " + this.currentRound;
		
		const round = await this.database.getOne( roundQuery );
		if( !round ) {
			Logger.logError( "Error Buying energy: " + ruondQuery );
			return this.dispatchError( "Invalid round" );
		}
		
		const user = await this.database.getOne( userQuery );
		if( !user ) {
			Logger.logError( "Error Buying energy: " + userQuery );
			return this.dispatchError( "Error buying energy" );
		}
			
		if( user.energy >= round.max_energy ) return this.dispatchError( "You already have full energy" );
		if( user.gems < 25 ) return this.dispatchError( "You can't afford that" );
			
			
		const creditQuery = "UPDATE users_rounds SET energy = energy + " + round.max_energy + " WHERE userid = " + this.id + " AND roundid = " + this.currentRound;
		
		const connection = await this.database.beginTransaction();
		let result = await connection.query( takeQuery );
		if( !result || result[ 0 ].affectedRows != 1 ) {
			await this.database.rollback( connection );
			
			Logger.logError( "Error Buying energy: " + takeQuery );						
			return this.dispatchError( "Error buying energy" );
		}
		
		result = await connection.query( creditQuery );
		if( !result || result[ 0 ].affectedRows != 1 ) {
			await this.database.rollback( connection );
			
			Logger.logError( "Error Buying energy: " + creditQuery );
			return this.dispatchError( "Error buying energy" );
		}
		
		await this.database.commit( connection );
			
		this.dispatch( "energy_BOUGHT" );
		this.update();
		
		user.gems = user.gems - 25;
		this.dispatch( "USER_UPDATED", { gems: user.gems } );
	}

	//==========================//
	//	Market Methods			//
	//==========================//
	async getMarketItemInfo( $item ) {
		this.debug( "getMarketItemInfo: " + $item );

		//Validate Input
		$item = this.validateString( $item );
		if( !$item ) return this.dispatchError( "Invalid Item" );
		
		const query = "SELECT price, total_bought, total_sold FROM market WHERE roundid = " + this.currentRound + " AND type = '" + $item + "' LIMIT 1";
		const item = await this.database.getOne( query );
		if( item ) {
			var packet = {};
			
			packet.available = item.total_sold - item.total_bought;
			packet.price = item.price;
			
			this.dispatch( "MARKET_ITEM_INFO", packet );
		} else {
			Logger.logError( "Error Getting Market Info: " + query );
		}		
	}

	async getMarketInfo() {
		this.debug( "getMarketInfo" );

		var data = {};
		data.auctions = {};
		data.market = {};
		data.market.resources = {};
		data.market.resources.wood = { type:"wood", price:0, total:0 };
		data.market.resources.stone = { type:"stone", price:0, total:0 };
		data.market.resources.food = { type:"food", price:0, total:0 };
		data.market.resources.metal = { type:"metal", price:0, total:0 };			

		const query = "SELECT type, price, ( total_sold - total_bought ) AS available FROM market WHERE roundid = " + this.currentRound;
		const items = await this.database.get( query );
		if( items ) {
			for( var i in items )
				data.market.resources[ items[ i ].type ] = items[ i ];			
		}
		
		this.dispatch( "MARKET_INFO", data );		
	}

	async buyResource( $item, $quantity, $price ) {
		this.debug( "buyResource: " + $item + ":" + $quantity + ":" + $price );
		
		if( $quantity <= 0 ) return false;
		
		const total = Math.ceil( $quantity * $price );
		const userQuery = "UPDATE users_rounds SET " + $item + " = " + $item + " + " + $quantity + ", gold = gold - " + total + " WHERE userid = " + this.id + " AND roundid = " + this.currentRound + " AND gold >= " + total + " LIMIT 1";
		const marketQuery = "UPDATE market SET total_bought = total_bought + " + $quantity + ", bought = bought + " + $quantity + " WHERE roundid = " + this.currentRound + " AND type = '" + $item + "' AND total_sold - total_bought - " + $quantity + " >= 0";

		if( this.gold < total ) return this.dispatch( "MARKET_ERROR", "You can't afford that" );
		
		const connection = await this.database.beginTransaction();
		
		let result = await connection.query( userQuery );
		if( !result || result[ 0 ].affectedRows != 1 ) {
			await this.database.rollback( connection );
			
			Logger.logError( "Error Buying Resource: " + userQuery );
			this.dispatch( "MARKET_ERROR", "Error buying " + $item );
			return false;
		}
		
		result = await connection.query( marketQuery );
		if( !result || result[ 0 ].affectedRows != 1 ) {
			await this.database.rollback( connection );
			
			Logger.logError( "Error Buying Resource: " + marketQuery );
			this.dispatch( "MARKET_ERROR", "Error buying " + $item );
			return false;
		}
		
		await this.database.commit( connection );
		
		this.debug( "Bought" );
		var data = {};
		data.quantity = $quantity;
		data.item = $item;
		data.cost = total;

		this.update();
		this.dispatch( "MARKET_BOUGHT", data );
		return true;
	}

	async buyMarket( $type, $item, $quantity, $price ) {
		this.debug( "buyMarket: " + $type + ":" + $item + ":" + $quantity + ":" + $price, true );

		//Validate Input
		$quantity = parseInt( $quantity );
		$type = this.validateString( $type );
		$item = this.validateString( $item );

		if( $quantity <= 0 ) return this.dispatch( "MARKET_ERROR", "Invalid Quantity" );
		if( !$type ) return this.dispatch( "MARKET_ERROR", "Missing Type" );
		if( !$item ) return this.dispatch( "MARKET_ERROR", "Missing Item" );	
		
		const marketQuery = "SELECT * FROM market WHERE roundid = " + this.currentRound + " AND type = '" + $item + "' LIMIT 1";
		const item = await this.database.getOne( marketQuery );
		if( item ) {
			const total = data.total_sold - data.total_bought;
			if( $quantity > total ) {
				if( total > 0 ) return this.dispatch( "MARKET_ERROR", "Only " + total + " " + $item + " is available" );
				else return this.dispatch( "MARKET_ERROR", "No " + $item + " is available" );
			}
			
			if( data.price <= $price ) this.buyResource( $item, $quantity, $price );
			else {
				//See if this price was just changed
				const historyQuery = "SELECT * FROM market_history WHERE roundid = " + this.currentRound + " AND type = '" + $item + "' AND timestamp > UNIX_TIMESTAMP() - 300 ORDER BY id DESC LIMIT 1";
				const history = await this.database.getOne( historyQuery );
				if( history ) {
					if( history.price == $price ) this.buyResource( $item, $quantity, $price );
					else {
						Logger.log( "Error Buying Market: PRICE MISMATCH" );
						return this.dispatch( "MARKET_ERROR", "Error buying " + $item );
					}						
				} else {
					Logger.logError( "Error Buying Market: " + historyQuery );
					return this.dispatch( "MARKET_ERROR", "Error buying " + $item );
				}						
			}
		} else {
			Logger.logError( "Error Buying Market: " + marketQuery );
			return this.dispatch( "MARKET_ERROR",  "Error buying " + $item );
		}			
	}

	async sellResource( $item, $quantity, $price ) {
		this.debug( "sellResource: " + $item + ":" + $quantity + ":" + $price );
		
		var total = Math.ceil( $quantity * $price );
		var query = "UPDATE users_rounds SET " + $item + " = " + $item + " - " + $quantity + ", gold = gold + " + total + " WHERE " + $item + " >= " + $quantity + " AND userid = " + this.id + " AND roundid = " + this.currentRound + " LIMIT 1";
		
		if( this[ $item ] < $quantity ) return this.dispatchError( "You only have " + Math.floor( this[ $item ] ) + " " + $item, "MARKET_ERROR" );		
		
		const connection = await this.database.beginTransaction();
		let result = await connection.query( query );
		if( !result || result[ 0 ].affectedRows != 1 ) {
			await this.database.rollback( connection );
			
			Logger.logError( "Error Selling Resource: " + query );			
			return this.dispatch( "MARKET_ERROR", "Error selling " + $item );
		}

		const recordQuery = "UPDATE market SET total_sold = total_sold + " + $quantity + ", sold = sold + " + $quantity + " WHERE roundid = " + this.currentRound + " AND type = '" + $item + "'";
		result = await connection.query( recordQuery );
		if( !result || result[ 0 ].affectedRows != 1 ) {
			await this.database.rollback( connection );
			
			Logger.logError( "Error Selling Resource: " + recordQuery );
			return this.dispatch( "MARKET_ERROR", "Error selling " + $item );
		}
		
		await this.database.commit( connection );
		
		var data = {};
		data.quantity = $quantity;
		data.item = $item;
		data.total = total;

		this.update();
		this.dispatch( "MARKET_SOLD", data );
		return true;		
	}

	async sellMarket( $type, $item, $quantity, $price ) {
		this.debug( "sellMarket: " + $type + ":" + $item + ":" + $quantity + ":" + $price );

		//Validate Input
		$quantity = parseInt( $quantity );
		$type = this.validateString( $type );
		$item = this.validateString( $item );

		if( $quantity <= 0 ) return this.dispatch( "ERROR", "Invalid Quantity" );
		if( !$type ) return this.dispatch( "ERROR", "Missing Type" );
		if( !$item ) return this.dispatch( "ERROR", "Missing Item" );

		const marketQuery = "SELECT * FROM market WHERE roundid = " + this.currentRound + " AND type = '" + $item + "' LIMIT 1";
		const historyQuery = "SELECT * FROM market_history WHERE roundid = " + this.currentRound + " AND type = '" + $item + "' AND timestamp > UNIX_TIMESTAMP() - 300 ORDER BY id DESC LIMIT 1";
		
		const item = await this.database.getOne( marketQuery );
		if( !item ) {
			Logger.logError( "Error Selling Market: " + marketQuery );
			return this.dispatch( "MARKET_ERROR", "Error selling " + $item );
		}		
		
		if( item.price >= $price ) this.sellResource( $item, $quantity, $price );
		else {
			//See if this price was just changed
			const history = await this.database.getOne( historyQuery );
			if( !history ) {
				Logger.logError( "Error Selling Market: " + historyQuery );
				return this.dispatch( "MARKET_ERROR", "Error selling " + $item );
			}
			
			//See if the recent price was equal, if so use it
			if( history.price == $price ) this.sellResource( $item, $quantity, $price );
			else {
				//TO DO - Record cheating attempt possibly?
				Logger.logError( "Error Selling Market: Price Mismatch" );
			}							
		}
	}

	//==========================//
	//	Social Methods			//
	//==========================//
	async lookUpUser( $username ) {		
		var ret = {};

		//Validate Input
		$username = this.validateString( $username );
		if( !$username ) return this.dispatchError( "Missing user" );

		const userInfoQuery = "SELECT users.id, username, avatar FROM users WHERE username = '" + $username + "'";
		const userInfo = await this.database.getOne( userInfoQuery );
		if( !userInfo ) {
			Logger.logError( "Error Looking Up User: " + userInfoQuery );
			return this.dispatchError( "Unknown user" );
		}
		
		ret.username = userInfo.username;
		ret.avatar = userInfo.avatar;

		if( this.currentRound ) {
			const userRoundQuery = "SELECT land, gold, food, wood, stone, metal FROM users_rounds WHERE userid = " + userInfo.id + " AND roundid = " + this.currentRound;
			const roundInfo = await this.database.getOne( userRoundQuery );
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
		const contactInfo = await this.database.get( contactQuery );
		if( contactInfo ) {
			for( var c in contactInfo ) {
				ret[ contactInfo[ c ].type ] = 1;
			}
		}
		
		this.dispatch( "USER_INFO_RETRIEVED", ret );							
	}

	async sendMail( $recipient, $message ) {
		this.debug( "sendMail" );

		//Validate Input
		$recipient = this.validateString( $recipient );
		$message = this.validateString( $message );

		if( !$recipient ) return this.dispatchError( "Missing recipient" );
		if( !$message ) return this.dispatchError( "Missing message" );

		const idQuery = "SELECT users.id FROM users WHERE username = '" + $recipient + "'";					
		const user = await this.database.getOne( idQuery );
		if( !user ) {
			Logger.logError( "Error Sending Mail: " + idQuery );
			return this.dispatchError( "User not found" );
		}
		
		const recipient = user.id;
		let blockQuery = "SELECT id FROM contacts WHERE contactid = " + recipient + " AND userid = " + this.id + " AND type = 'blocked' LIMIT 1";
		let blocked = await this.database.getOne( blockQuery );
		if( blocked ) return this.dispatchError( "You can't send mail to someone you've blocked" );
		
		blockQuery = "SELECT id FROM contacts WHERE contactid = " + this.id + " AND userid = " + recipient + " AND type = 'blocked' LIMIT 1";
		blocked = await this.database.getOne( blockQuery );
		
		const connection = await this.database.beginTransaction();
		const mailQuery = "INSERT INTO mails SET sender = " + this.id + ", recipient = " + recipient + ", message = '" + $message + "', senderview = 1, recipientview = " + ( blocked ? "0" : "1" ) + ", unread = " + ( blocked ? "0" : "1" ) + ", time = UNIX_TIMESTAMP()";						
		const result = await connection.query( mailQuery );
		if( !result || result[ 0 ].affectedRows != 1 ) {
			await this.database.rollback( connection );
			
			return this.dispatch( "MAIL_ERROR" );
		}		
		
		await this.database.commit( connection );
			
		this.dispatch( "MAIL_SENT" );
		this.emit( "MAIL_SENT", { recipient:recipient, sender:this.username } );
	}

	async sendShout( $shout ) {
		//Validate Input
		$shout = this.validateString( $shout );
		if( !$shout ) return this.dispatchError( "Empty shout" );

		const check = await this.database.getOne( "SELECT * FROM shoutbox WHERE userid = " + this.id + " AND time > UNIX_TIMESTAMP() - 60" );
		if( check ) return this.dispatch( "SHOUT_ERROR" );
		
		const query = "INSERT INTO shoutbox SET userid = " + this.id + ", shout = '" + $shout + "', time = UNIX_TIMESTAMP()";
		const connection = await this.database.beginTransaction();
		
		const result = await connection.query( query );
		if( !result || result[ 0 ].affectedRows != 1 ) {
			await this.database.rollback( connection );
			
			Logger.logError( "Error Inserting Shout: " + query );
			this.dispatchError( "Error sending shout" ); 
		}
		
		await this.database.commit( connection );
		this.dispatch( "SHOUT_SENT" );
	}

	async getContacts() {		
		var packet = {};
		
		packet.friends = await this.database.get( "SELECT avatar, username FROM users INNER JOIN contacts ON contactid = users.id WHERE contacts.userid = " + this.id + " AND type='friend'" );
		packet.enemies = await this.database.get( "SELECT avatar, username FROM users INNER JOIN contacts ON contactid = users.id WHERE contacts.userid = " + this.id + " AND type='enemy'" );
		packet.blocked = await this.database.get( "SELECT avatar, username FROM users INNER JOIN contacts ON contactid = users.id WHERE contacts.userid = " + this.id + " AND type='blocked'" );
		
		this.dispatch( "CONTACTS_RETRIEVED" );		
	}

	async getConversation( $username, $page ) {
		this.debug( "getConversation: " + $username + " : " + $page );

		//Validate Input
		$username = this.validateString( $username );
		$page = parseInt( $page );

		if( !$username ) return this.dispatchError( "Missing user" );
		if( !$page || $page <= 0 ) return this.dispatchError( "Invalid page" );
		
		const userQuery = "SELECT id FROM users WHERE username = '" + $username + "'";
		const recipient = await this.database.getOne( userQuery );
		if( recipient ) {
			const readQuery = "UPDATE mails SET unread = 0 WHERE recipient = " + this.id + " AND sender = " + recipient.id;
			const retrieveQuery = "SELECT username, avatar, message, time FROM mails INNER JOIN users ON users.id = sender WHERE ( ( sender = " + this.id + " and recipient = " + recipient.id + " AND senderview = 1 ) or ( sender = " + recipient.id + " AND recipient = " + this.id + " and recipientview = 1 ) ) ORDER BY mails.id DESC;"
			
			const mails = await this.database.get( retrieveQuery );
			this.dispatch( "MAIL_DETAILS_RETRIEVED", mails );
			
			const connection = await this.database.beginTransaction();
			const result = await connection.query( readQuery );
			if( result && result[ 0 ].affectedRows >= 1 ) await this.database.commit( connection );			
			
		} else {
			Logger.logError( "Error Getting Conversation: " + userQuery );
			this.dispatchError( "MAIL_ERROR" );
		}
	}

	async getMails( $page, $per ) {
		this.debug( "getMails: " + $page + "," + $per );

		//Validate Input
		$page = parseInt( $page );
		$per = parseInt( $per );

		if( !$page || $page <= 0 ) $page = 1;
		if( !$per || $per <= 0 ) $per = 15;

		var data = {};		
		const countQuery = "SELECT COUNT( mailProcessed.id ) AS total FROM ( SELECT MAX( id ) as id, MAX( time ) AS time, IF( sender = " + this.id + ", recipient, sender ) AS userid, SUM( IF( sender = " + this.id + ", 0, unread ) ) AS unread, SUM( IF( sender = " + this.id + ", IF( senderview = 1, 1, 0 ), IF( recipientview = 1, 1, 0 ) ) ) AS total FROM mails WHERE ( sender = " + this.id + " or recipient = " + this.id + " ) AND IF( sender = " + this.id + ", recipientview, senderview ) = 1 GROUP BY userid ORDER BY id DESC ) AS mailProcessed INNER JOIN mails ON mails.id = mailProcessed.id INNER JOIN users ON users.id = mailProcessed.userid WHERE total > 0 ORDER BY mailProcessed.id DESC";
		const retrieveQuery = "SELECT username, avatar, mailProcessed.unread, message, mailProcessed.time FROM ( SELECT MAX( id ) as id, MAX( time ) AS time, IF( sender = " + this.id + ", recipient, sender ) AS userid, SUM( IF( sender = " + this.id + ", 0, if( recipientview = 1, unread, 0 ) ) ) AS unread, SUM( IF( sender = " + this.id + ", IF( senderview = 1, 1, 0 ), IF( recipientview = 1, 1, 0 ) ) ) AS total FROM mails WHERE ( sender = " + this.id + " or recipient = " + this.id + " ) AND IF( sender = " + this.id + ", recipientview, senderview ) = 1 GROUP BY userid ORDER BY id DESC ) AS mailProcessed INNER JOIN mails ON mails.id = mailProcessed.id INNER JOIN users ON users.id = mailProcessed.userid WHERE total > 0 ORDER BY mailProcessed.id DESC LIMIT " + ( ( $page - 1 ) * $per ) + "," + $per;

		const result = await this.database.getOne( countQuery );		
		if( result ) {
			data.pages = Math.ceil( result.total / $per );
			if( $page > data.pages ) $page = data.pages;
			if( $page <= 0 ) $page = 1;
			data.page = $page;
			data.total = result.total;
			
			data.mails = await this.database.get( retrieveQuery );			
			this.dispatch( "MAILS_RETRIEVED", data );
		} else {
			Logger.logError( "Error Getting Mails: " + countQuery );
			return this.dispatchError( "Error getting mails" );
		}		
	}

	async deleteMail( $name ) {
		this.debug( "deleteMail: " + $name );

		//Validate Input
		$name = this.validateString( $name );
		if( !$name ) return this.dispatch( "ERROR", "Missing User" );
		
		const userQuery = "SELECT id FROM users WHERE username = '" + $name + "' LIMIT 1";
		const user = await this.database.getOne( userQuer );
		if( user ) {
			const sentQuery = "UPDATE mails SET senderview = 0 WHERE sender = " + this.id + " AND recipient = " + user.id;
			const receivedQuery = "UPDATE mails SET unread = 0, recipientview = 0 WHERE sender = " + user.id + " AND recipient = " + this.id;
			const connection = await this.database.beginTransaction();					
			
			await connection.query( sentQuery );
			await connection.query( receivedQuery );
			
			await this.database.commit( connection );
			this.dispatch( "MAIL_DELETED" );
		} else {
			Logger.logError( "Error Deleting Mail: " + userQuery );
			this.dispatchError( "User not found" );
		}		
	}

	async deleteMails() {
		this.debug( "deleteMails" );

		const connection = await this.database.beginTransaction();
				
		await connection.query( "UPDATE mails SET senderview = 0 WHERE sender = " + this.id );
		await connection.query( "UPDATE mails SET recipientview = 0, unread = 0 WHERE recipient = " + this.id );

		await this.database.commit( connection );
		this.dispatch( "MAILS_DELETED" );
	}

	async markAllMail() {
		this.debug( "markAllMail" );

		const query = "UPDATE mails SET unread = 0 WHERE recipient = " + this.id;
		const connection = await this.database.beginTransaction();
		await connection.query( query );
		await this.database.commit( connection );
				
		this.dispatch( "MAILS_MARKED_READ" );
	}

	async addFriend( $name ) {
		this.debug( "addFriend: " + $name );

		//Validate Input
		$name = this.validateString( $name );
		if( !$name ) return this.dispatch( "ERROR", "Missing User" );
		
		const findQuery = "SELECT id FROM users WHERE username = '" + $name + "'";
		var friend = await this.connection.getOne( findQuery );
		if( !friend ) {
			Logger.logError( "Error Adding Friend: " + findQuery );
			return this.dispatchError( "User not found" );
		}
		
		friend = friend.id;
		
		const checkQuery = "SELECT id FROM contacts WHERE userid = " + this.id + " AND contactid = " + friend + " AND type='friend'";
		const insertQuery = "INSERT INTO contacts SET userid = " + this.id + ", contactid = " + friend + ", type='friend'";
		
		var data = {};
		data.username = $name;
		
		const check = await this.database.getOne( checkQuery );
		if( check ) {
			this.dispatch( "FRIEND_ADDED", data );
		} else {
			const connection = await this.database.beginTransaction();
			const result = await connection.query( insertQuery );
			if( result && result[ 0 ].affectedRows == 1 ) {
				await this.database.commit( connection );
				this.dispatch( "FRIEND_ADDED", data );
			} else {
				await this.database.rollback( connection );
				
				Logger.logError( "Error Adding Friend: " + insertQuery );
				return this.dispatchError( "Error adding friend" );
			}
		}				
	}

	async removeFriend( $name ) {
		this.debug( "removeFriend: " + $name );

		//Validate Input
		$name = this.validateString( $name );
		if( !$name ) return this.dispatch( "ERROR", "Missing Friend" );
			
		const userQuery = "SELECT id FROM users WHERE username = '" + $name + "'";
		let friend = await this.database.getOne( userQuery );
		if( !friend ) {
			Logger.logError( "Error Removing Friend: " + userQuery );
			return this.dispatchError( "User not found" );
		}
		
		friend = friend.id;
		
		const query = "DELETE FROM contacts WHERE userid = " + this.id + " AND contactid = " + friend + " AND type='friend'";
		const connection = await this.database.beginTransaction();
		
		const result = await connection.query( query );
		if( result && result[ 0 ].affectedRows == 1 ) {
			await this.database.commit( connection );
			
			var data = {};
			data.username = $name;
			
			this.dispatch( "FRIEND_REMOVED", data );
		} else {
			await this.database.rollback( connection );
			
			Logger.logError( "Error Removing Friend: " + query );
			return this.dispatchError( "Error removing friend" );
		}
	}

	async addEnemy( $name ) {
		this.debug( "addEnemy: " + $name );

		//Validate  Input
		$name = this.validateString( $name );
		if( !$name ) return this.dispatchError( "Missing user" );

		const userQuery = "SELECT id FROM users WHERE username = '" + $name + "'";
		let enemy = await this.database.getOne( userQuery );
		if( !enemy ) {
			Logger.logError( "Error Adding Enemy: " + userQuery );
			return this.dispatchError( "Player not found" );
		}
		
		enemy = enemy.id;
		
		const enemyQuery = "SELECT id FROM contacts WHERE userid = " + this.id + " AND contactid = " + enemy + " AND type = 'enemy'";
		const insertQuery = "INSERT INTO contacts SET userid = " + this.id + ", contactid = " + enemy + ", type = 'enemy'";
		
		var data = {};
		data.username = $name;
		
		let result = await this.database.getOne( enemyQuery );
		if( result ) {
			this.dispatch( "ENEMY_ADDED", data );
		} else {
			const connection = await this.database.beginTransaction();
			result = await connection.query( insertQuery );
			if( result && result[ 0 ].affectedRows == 1 ) {
				await this.database.commit( connection );
				this.dispatch( "ENEMY_ADDED", data );
			} else {
				await this.database.rollback( connection );
				
				Logger.logError( "Error Adding Enemy: " + insertQuery );
				return this.dispatchError( "Error adding enemy" );
			}
		}		
	}

	async removeEnemy( $name ) {
		this.debug( "removeEnemy: " + $name );

		//Validate Input
		$name = this.validateString( $name );
		if( !$name ) return this.dispatchError( "Missing enemy" );
			
		const userQuery = "SELECT id FROM users WHERE username = '" + $name + "'";
		let enemy = await this.database.getOne( userQuery );
		if( !enemy ) {
			Logger.logError( "Error Removing Enemy: " + userQuery );
			return this.dispatchError( "User not found" );
		}
		
		enemy = enemy.id;
		
		const query = "DELETE FROM contacts WHERE userid = " + this.id + " AND contactid = " + enemy + " AND type='enemy'";
		const connection = await this.database.beginTransaction();
		
		const result = await connection.query( query );
		if( result && result[ 0 ].affectedRows == 1 ) {
			await this.database.commit( connection );
			
			var data = {};
			data.username = $name;
			
			this.dispatch( "ENEMY_REMOVED", data );
		} else {
			await this.database.rollback( connection );
			
			Logger.logError( "Error Removing Enemy: " + query );
			return this.dispatchError( "Error removing enemy" );
		}
	}

	async addBlocked( $name ) {
		this.debug( "addBlocked: " + $name );

		//Validate  Input
		$name = this.validateString( $name );
		if( $name === "System" ) return this.dispatchError( "You can't block the System!" );
		if( !$name ) return this.dispatchError( "Missing user" );

		const userQuery = "SELECT id FROM users WHERE username = '" + $name + "'";
		let block = await this.database.getOne( userQuery );
		if( !block ) {
			Logger.logError( "Error Adding Block: " + userQuery );
			return this.dispatchError( "Player not found" );
		}
		
		block = block.id;
		
		const blockQuery = "SELECT id FROM contacts WHERE userid = " + this.id + " AND contactid = " + block + " AND type = 'blocked'";
		const insertQuery = "INSERT INTO contacts SET userid = " + this.id + ", contactid = " + block + ", type = 'blocked'";
		
		var data = {};
		data.username = $name;
		
		let result = await this.database.getOne( blockQuery );
		if( result ) {
			this.dispatch( "BLOCK_ADDED", data );
		} else {
			const connection = await this.database.beginTransaction();
			result = await connection.query( insertQuery );
			if( result && result[ 0 ].affectedRows == 1 ) {
				await this.database.commit( connection );
				this.dispatch( "BLOCK_ADDED", data );
			} else {
				await this.database.rollback( connection );
				
				Logger.logError( "Error Adding Block: " + insertQuery );
				return this.dispatchError( "Error adding block" );
			}
		}
	}

	async removeBlocked( $name ) {
		this.debug( "removeBlocked: " + $name );

		//Validate Input
		$name = this.validateString( $name );
		if( !$name ) return this.dispatchError( "Missing user" );
			
		const userQuery = "SELECT id FROM users WHERE username = '" + $name + "'";
		let block = await this.database.getOne( userQuery );
		if( !block ) {
			Logger.logError( "Error Removing Block: " + userQuery );
			return this.dispatchError( "User not found" );
		}
		
		block = block.id;
		
		const query = "DELETE FROM contacts WHERE userid = " + this.id + " AND contactid = " + block + " AND type='blocked'";
		const connection = await this.database.beginTransaction();
		
		const result = await connection.query( query );
		if( result && result[ 0 ].affectedRows == 1 ) {
			await this.database.commit( connection );
			
			var data = {};
			data.username = $name;
			
			this.dispatch( "BLOCK_REMOVED", data );
		} else {
			await this.database.rollback( connection );
			
			Logger.logError( "Error Removing Block: " + query );
			return this.dispatchError( "Error removing block" );
		}
	}

	async getNearbyRankings( $per ) {
		this.debug( "getNearbyRankings" );

		//Validate Input
		$per = parseInt( $per );
		if( !$per || $per <= 0 ) $per = 15;

		let rankQuery = "SELECT rank FROM rankings WHERE roundid = " + this.currentRound + " AND userid = " + this.id;
		let rank = await this.database.getOne( rankQuery );
		if( rank ) {
			rank = rank.rank;
			
			if( rank > $per ) rankQuery = "SELECT rank, username, avatar FROM rankings INNER JOIN users ON users.id = userid WHERE roundid = " + this.currentRound + " ORDER BY rank LIMIT " + ( rank - Math.floor( $per / 2 ) ) + ", " + $per;
			else rankQuery = "SELECT rank, username, avatar FROM rankings INNER JOIN users ON users.id = userid WHERE roundid = " + this.currentRound + " ORDER BY rank LIMIT " + $per;
			
			let ranks = await this.database.get( rankQuery );
			this.dispatch( "RANKINGS_NEAR", ranks );
		} else {
			Logger.logError( "Error Getting Nearby Rankings: " + rankQuery );
			return this.dispatchError( "Error getting rankings" );
		}
	}

	async getTopRankings() {
		this.debug( "getTopRankings" );
		
		const query = "SELECT rank, username, avatar FROM rankings INNER JOIN users ON users.id = userid WHERE roundid = " + this.currentRound + " ORDER BY rank LIMIT 20";
		const results = await this.database.get( query );
		this.dispatch( "RANKINGS_TOP", results );		
	}

	//==========================//
	//	Job Methods				//
	//==========================//
	async checkJobs() {
		this.debug( "checkJobs" );
		
		let data = await this.database.getOne( "SELECT COUNT(id) AS total FROM users_jobs WHERE userid = " + this.id + " AND ( claimed = 0 OR claimed > UNIX_TIMESTAMP() - " + this.jobThrottleTime + " )" );
		let count = data.total;		
		
		while( count++ < this.jobThrottleAmount )			
			await this.createJob();
	}
	
	async createJob() {
		this.debug( "createJob" );
		
		let reward = await ItemManager.getRandomItem( 2 );		
		let job = guid.v4();
		let result = await this.database.execute( "INSERT INTO users_jobs SET guid = '" + job + "', userid = " + this.id + ", reward = " + reward.id + ", claimed = 0" );		
	}
	
	async clearJobs() {
		this.debug( "clearJobs" );		
		await this.database.execute( "DELETE FROM users_jobs WHERE userid = " + this.id );
	}
	
	async getJobs() {
		this.debug( "getJobs" );
		
		console.log( "CLEARING STUFF" );
		await this.clearJobs();
		await this.checkJobs();
		
		let jobs = await this.database.get( "SELECT guid, reward FROM users_jobs WHERE userid = " + this.id + " AND claimed = 0" );
		for( var job in jobs ) {			
			jobs[ job ].type = ItemManager.getItemByID( jobs[ job ].reward ).type;
			delete jobs[ job ].reward;			
		}
		
		console.log( jobs );
		this.dispatch( "JOBS_RETRIEVED", jobs );
	}
	
	async claimJob( $job ) {
		this.debug( "claimJob: " + $job );
	}
	
	//==========================//
	//	Combat Methods			//
	//==========================//
	async getTargets() {
		this.debug( "getTargets" );
		
		const powerQuery = "SELECT power FROM users_rounds WHERE userid = " + this.id + " AND roundid = " + this.currentRound + " LIMIT 1";			
		
		
		const data = await this.database.getOne( powerQuery );
		if( !data ) {
			Logger.logError( "Error Getting Targets: " + powerQuery );
			return this.dispatchError( "Error getting targets" );
		}
		
		const targetQuery = "SELECT username, avatar, power, land FROM users INNER JOIN users_rounds ON users.id = users_rounds.userid WHERE users.id <> " + this.id + " AND roundid = " + this.currentRound + " AND power >= " + Math.floor( data.power / 2 ) + " AND power <= " + ( data.power * 2 ) + " LIMIT 15";
		const targets = await this.database.get( targetQuery );
		
		this.dispatch( "TARGETS_RECEIVED", targets );			
	}

	async getFights( $page, $per ) {
		this.debug( "getFights: " + $page + "," + $per );

		//Validate Input
		$page = parseInt( $page );
		$per = parseInt( $per );

		if( !$page || $page <= 0 ) $page = 1;
		if( !$per || $per <= 0 ) $per = 15;

		var data = {};		
		const countQuery = "SELECT COUNT(id) AS total FROM fights WHERE ( ( attacker = " + this.id + " AND attacker_view = 1 ) OR ( defender = " + this.id + " AND defender_view = 1 ) ) AND roundid = " + this.currentRound + " ORDER BY ID DESC";
		this.debug( "Count Query: " + countQuery );
		let info = await this.database.getOne( countQuery );
		if( !info ) {
			Logger.logError( "Error Getting Fights: " + countQuery );
			return this.dispatchError( "Error getting fights" );
		}
		
		data.pages = Math.ceil( info.total / $per );
		if( $page > data.pages ) $page = data.pages;
		if( $page <= 0 ) $page = 1;
		data.page = $page;
		data.total = info.total;
		
		const retrieveQuery = "SELECT attack, type, won, time, username, fights.guid, avatar FROM ( SELECT id, guid, type, IF( attacker = " + this.id + ", defender, attacker) AS opponent, IF( attacker = " + this.id + ", 1, 0 ) AS attack, if( winner = " + this.id + ", 1, 0 ) AS won, time FROM fights WHERE ( ( attacker = " + this.id + " AND attacker_view = 1 ) OR ( defender = " + this.id + " AND defender_view = 1 ) ) AND roundid = " + this.currentRound + " ORDER BY ID DESC ) as fights INNER JOIN users ON opponent = users.id ORDER BY fights.id DESC LIMIT " + ( ( $page - 1 ) * $per ) + "," + $per;
		this.debug( "Query: " + retrieveQuery );
		data.fights = await this.database.get( retrieveQuery );
		
		this.debug( "Done Getting Fights" );
		this.dispatch( "ATTACKS_RETRIEVED", data );				
	}

	/*
	async getDefender( $target ) {
		const userQuery = "SELECT users.id, power, username FROM users INNER JOIN users_rounds ON users_rounds.userid = users.id where username = '" + $target + "' AND users_rounds.roundid = " + this.currentRound;
		const user = await this.database.getOne( userQuery );
		return user;
	}
	*/
	
	async validTarget( $defender ) {
		var ret = {};
		ret.valid = false;
		
		if( this.power > $defender.power * 2 ) {
			ret.message = "You are too powerful";
		} else if( this.power * 2 < $defender.power ) {
			ret.message = "They're too strong for you";
		} else {
			ret.valid = true;
		}
		
		return ret;
	}
	
	/*
	async processCombatDefeat( $loser ) {
		this.debug( "processCombatDefeat" );
		
		var ret = {};
		ret.gain = 0;
		ret.destroy = 0;
		ret.free = 0;
		
		
		const data = await this.database.getOne( "SELECT land FROM users_rounds WHERE userid = " + $loser.id + " AND roundid = " + this.currentRound );
		if( !data ) { ret.error = true; return ret; }
		
		//Determine the land lost
		var seed = Math.floor( data.land * .02 );
		var gain = Math.floor( ( Math.random() * seed / 2 ) + ( seed / 2 ) );

		ret.gain = gain;

		//We took land, destroy some buildings
		if( gain > 0 ) {
			const buildingQuery = "SELECT name, plural, buildingid, quantity FROM users_rounds_buildings INNER JOIN buildings ON buildings.id = buildingid WHERE userid = " + $loser.id + " AND roundid = " + this.currentRound + " ORDER BY quantity ASC";
			let buildings = await this.database.get( buildingQuery );
			if( buildings && buildings.length > 0 ) {
				var free = 0; //The land we need to free up
				var length = buildings.length;
				var toDestroy = Math.floor( ( Math.random() * gain * 2 ) + gain );
				var destroyed = "";
				
				var totalBuildings = 0;
				for( var b in buildings ) totalBuildings += buildings[ b ].quantity;
								
				for( var i = 0; i < toDestroy; i++ ) {
					var building = Math.random() * totalBuildings;//Math.floor( ( Math.random() * length - 1 ) + 1 );					
					for( var b in buildings ) {
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
				
				for( var b in buildings ) {					
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
	*/
	/*
	async processUnitLosses( $player, $connection ) {
		this.debug( "processUnitLosses" );
		
		var ret = {};
		ret.lost = "";
		
		for( var a in $player.army ) {
			if( $player.army[ a ].killed ) {
				ret.lost += ( ret.lost != "" ? ", " : "" ) + $player.army[ a ].killed + " " + ( $player.army[ a ].killed != 1 ? $player.army[ a ].plural : $player.army[ a ].name );
				
				let query = "";
				if( $player.army[ a ].quantity > 0 ) query = "UPDATE users_rounds_units SET quantity = quantity - " + $player.army[ a ].killed + " WHERE roundid = " + this.currentRound + " AND userid = " + $player.id + " AND unitid = " + $player.army[ a ].id;
				else query = "DELETE FROM users_rounds_units WHERE userid = " + $player.id + " AND roundid = " + this.currentRound + " AND unitid = " + $player.army[ a ].id;
								
				const result = await $connection.query( query );
				if( !result || result[ 0 ].affectedRows != 1 ) {
					ret.error = query;
					return ret;
				}
			}
		}
		
		return ret;
	}
	*/

	/*
	async processBuildingLosses( $defender, $record, $connection ) {
		this.debug( "processBuildingLosses" );
		
		var ret = {};
		
		for( var b in $record.buildings ) {
			if( $record.buildings[ b ].destroyed ) {
				let query = "";
				
				if( $record.buildings[ b ].destroyed == $record.buildings[ b ].quantity ) query = "DELETE FROM users_rounds_buildings WHERE userid = " + $defender.id + " AND roundid = " + this.currentRound + " AND buildingid = " + $record.buildings[ b ].buildingid;
				else query = "UPDATE users_rounds_buildings SET quantity = quantity - " + $record.buildings[ b ].destroyed + " WHERE userid = " + $defender.id + " AND roundid = " + this.currentRound + " AND buildingid = " + $record.buildings[ b ].buildingid;
				let result = await $connection.query( query );
				if( !result || result[ 0 ].affectedRows != 1 ) {
					ret.error = query;
					return ret;
				}
			}
		}
		
		ret.success = true;
		return ret;
	}*/
	
	async attack( $target ) {
		this.debug( "attack: " + $target );

		let energy = 1;
		
		//Validate Input
		$target = this.validateString( $target );
		if( !$target ) return this.dispatchError( "Missing target" );

		let c = new Combat( this.database, this.id, $target, this.currentRound );
		await c.Load();
		await c.Simulate();
		let result = await c.Attack();
		if( !result ) console.log( "FAILED TO ATTACK: " + c.error );
		console.log( c );
		console.log( result );
		return;
		
		let defender = await this.getDefender( $target );		
		let check = await this.validTarget( defender );
		if( !check.valid ) return this.dispatchError( check.message );
		
		//Grab the armies and build them
		let attackingArmy = await this.database.get( "SELECT unitid, quantity FROM users_rounds_units WHERE userid = " + this.id + " AND roundid = " + this.currentRound );		
		if( !attackingArmy || attackingArmy.length < 1 ) return this.dispatchError( "You have no army to attack with" );
		let defendingArmy = await this.database.get( "SELECT unitid, quantity FROM users_rounds_units WHERE userid = " + defender.id + " AND roundid = " + this.currentRound );			
		
		for( var a in attackingArmy ) {
			var quantity = attackingArmy[ a ].quantity;
			attackingArmy[ a ] = UnitManager.getUnitByID( attackingArmy[ a ].unitid );
			attackingArmy[ a ].quantity = quantity;
		}
		
		for( var d in defendingArmy ) {
			var quantity = defendingArmy[ d ].quantity;
			defendingArmy[ d ] = UnitManager.getUnitByID( defendingArmy[ d ].unitid );
			defendingArmy[ d ].quantity = quantity;
		}
		
		const attacker = { username:this.username, id:this.id, army:attackingArmy };		
		defender.army = defendingArmy;
		
		//Process combat and calculate resolution if we win
		let combat = await this.processCombat( attacker, defender );		
		let defeat = combat.victory ? await this.processCombatDefeat( defender ) : "";			
		
		return;
		//Create the connection
		const connection = await this.database.beginTransaction();
		
		//Outcome for building
		let outcome = "";		
		
		try {
			//Record our unit losses
			let attackerLosses = await this.processUnitLosses( attacker, connection );
			if( attackerLosses.error ) { await this.database.rollback( connection ); Logger.logError( "Error Attacking: " + attackerLosses.error ); return this.dispatchError( "Error attacking" ); }
			
			let defenderLosses = await this.processUnitLosses( defender, connection );
			if( defenderLosses.error ) { await this.database.rollback( connection ); Logger.logError( "Error Attacking: " + defenderLosses.error ); return this.dispatchError( "Error attacking" ); }					
						
			//Build up wording
			let losses = attackerLosses && attackerLosses.lost ? this.username + " lost " + attackerLosses.lost + "\n" : "";
			losses += defenderLosses && defenderLosses.lost ? defender.username + " lost " + defenderLosses.lost + "\n" : "";
			
			if( combat.victory ) {
				let query = "UPDATE users_rounds SET land = land + " + defeat.gain + ", land_free = land_free + " + defeat.gain + ", energy = energy - " + energy + ", energy_spent = energy_spent + " + energy + " WHERE userid = " + this.id + " AND roundid = " + this.currentRound + " AND energy >= " + energy;				
				let success = await connection.query( query );
				if( !success || success[ 0 ].affectedRows != 1 ) {
					await this.database.rollback( connection );
					Logger.logError( "Error Attacking: " + query );
					return this.dispatchError( "Error attacking" );
				}
								
				let totalBuildings = await this.database.getOne( "SELECT SUM(quantity) AS total FROM users_rounds_buildings WHERE userid = " + defender.id + " AND roundid = " + this.currentRound );				
				if( totalBuildings.total  ) totalBuildings = totalBuildings.total;
				else totalBuildings = 0;
								
				query = "UPDATE users_rounds SET land = land - " + ( defeat.gain + defeat.destroy ) + ", land_free = land - " + totalBuildings + " WHERE userid = " + defender.id + " AND roundid = " + this.currentRound;
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
				
				let query = "UPDATE users_rounds SET energy_spent = energy_spent + " + energy + ", energy = energy - " + energy + " WHERE userid = " + this.id + " AND roundid = " + this.currentRound + " AND energy >= 1";
				let success = await connection.query( query );
				if( !success || success[ 0 ].affectedRows != 1 ) {
					await this.database.rollback( connection );
					Logger.logError( "Error Attacking: " + query );
					return this.dispatchError( "Error attacking" );
				}
			}
			
			let query = "INSERT INTO events SET userid = " + defender.id + ", roundid = " + this.currentRound + ", type = 'attack', event = '" + this.username + " attacked you.  You lost!', unread = 1, deleted = 0, time = UNIX_TIMESTAMP()";
			let result = await connection.query( query );
			if( !result || result[ 0 ].affectedRows != 1 ) {
				Logger.logError( "Error Recording Attack Event: " + query );
			}
			await this.database.commit( connection );

			outcome += ( losses != "" ? "\n\n" + losses : "" );					
			
			const log = Buffer.from( combat.log ).toString( "base64" );
			outcome = Buffer.from( outcome ).toString( "base64" );
			this.saveFight( defender, "attack", true, log, outcome );					
			
			this.calculatePower( this.id, this.currentRound );
			this.calculatePower( defender.id, this.currentRound );

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
	}

	async raid( $target ) {
		this.debug( "raid: " + $target );

		let energy = 1;
		
		//Validate Input
		$target = this.validateString( $target );
		if( !$target ) return this.dispatchError( "Missing Target" );

		let c = new Combat( this.database, this.id, $target, this.currentRound );
		await c.Load();
		await c.Simulate();
		let result = await c.Raid();
		if( !result ) console.log( "FAILED TO ATTACK: " + c.error );
		console.log( c );
		console.log( result );

		return;
		
		//Grab and build our armies
		let attackingArmy = await this.database.get( "SELECT unitid, quantity, quantity * ( attack + defense ) / ( 1 + ranged ) AS totalpower FROM users_rounds_units INNER JOIN units ON units.id = unitid WHERE userid = " + this.id + " AND roundid = " + this.currentRound + " ORDER BY totalpower DESC LIMIT 1" );
		if( !attackingArmy || attackingArmy.length < 1 ) return this.dispatchError( "You have no army to attack with" );
		let defendingArmy = await this.database.get( "SELECT unitid, quantity, quantity * ( attack + defense ) / ( 1 + ranged ) AS totalpower FROM users_rounds_units INNER JOIN units ON units.id = unitid WHERE userid = " + defender.id + " AND roundid = " + this.currentRound + " ORDER BY totalpower DESC" );
		
		if( !attackingArmy || attackingArmy.length != 1 ) {
			Logger.logError( "Error raiding: No army" );
			return this.dispatchError( "You have no army to raid with" );
		}
		
		for( let a in attackingArmy ) {
			let quantity = attackingArmy[ a ].quantity;
			attackingArmy[ a ] = UnitManager.getUnitByID( attackingArmy[ a ].unitid );
			attackingArmy[ a ].quantity = quantity;
		}
		
		for( let d in defendingArmy ) {
			let quantity = defendingArmy[ d ].quantity;
			defendingArmy[ d ] = UnitManager.getUnitByID( defendingArmy[ d ].unitid );
			defendingArmy[ d ].quantity = quantity;
		}
		
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
			var log = "";

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
			let query = "UPDATE users_rounds SET energy_spent = energy_spent + " + energy + ", energy = energy - " + energy + " WHERE userid = " + this.id + " AND roundid = " + this.currentRound + " AND energy >= 1";
			let result = await connection.query( query );
			if( !result || result[ 0 ].affectedRows != 1 ) {
				await this.database.rollback( connection );
				
				Logger.logError( "Error Raiding: " + query );
				return this.dispatchError( "Error raiding" );
			}
			
			if( attacker.army[ 0 ].killed ) {
				if( attacker.army[ 0 ].quantity > 0 )
					query = "UPDATE users_rounds_units SET quantity = quantity - " + attacker.army[ 0 ].killed + " WHERE userid = " + this.id + " AND roundid = " + this.currentRound + " AND unitid = " + attacker.army[ 0 ].id + " AND quantity > " + attacker.army[ 0 ].killed;
				else query = "DELETE FROM users_rounds_units WHERE userid = " + this.id + " AND roundid = " + this.currentRound + " AND unitid = " + attacker.army[ 0 ].id;
				
				result = await connection.query( query );
				if( !result || result[ 0 ].affectedRows != 1 ) {
					await this.database.rollback( connection );
					
					Logger.logError( "Error Raiding: " + query );
					return this.dispatchError( "Error raiding" );
				}
			}
			
			await this.database.commit( connection );			

			this.calculatePower( this.id, this.currentRound );
			
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
			
			let query = "SELECT wood, food, gold, metal, stone FROM users_rounds WHERE userid = " + defender.id + " AND roundid = " + this.currentRound + " LIMIT 1";
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

			
			let defenderUpdate = "UPDATE users_rounds SET wood = wood - " + wood + ", stone = stone - " + stone + ", gold = gold - " + gold + ", food = food - " + food + ", metal = metal - " + metal + " WHERE userid = " + defender.id + " AND roundid = " + this.currentRound + " AND wood >= " + wood + " AND stone >= " + stone + " AND gold >= " + gold + " AND food >= " + food;
			let attackerUpdate = "UPDATE users_rounds SET energy_spent = energy_spent + " + energy + ", energy = energy - " + energy + ", wood = wood + " + wood + ", stone = stone + " + stone + ", gold = gold + " + gold + ", food = food + " + food + ", metal = metal + " + metal + " WHERE userid = " + this.id + " AND roundid = " + this.currentRound + " AND energy >= " + energy;					
						
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

	/*
	async processUnitCombat( $attacker, $defender, $attackerName, $defenderName ) {
		if( $defender.quantity == 0 ) return;

		var damage = Math.ceil( ( Math.random() * $attacker.quantity * $attacker.attack / 2) + ( $attacker.quantity * $attacker.attack / 2 ) );
		var killed = Math.floor( damage / $defender.health );
		if( killed > $defender.quantity ) killed = $defender.quantity;

		$defender.quantity -= killed;
		if( $defender.quantity < 0 ) $defender.quantity = 0;

		var msg = $attackerName + "'s " + $attacker.quantity + " " + ( $attacker.quantity == 1 ? $attacker.name : $attacker.plural ) + " did " + damage + " damage to " + $defenderName + "'s " + ( $defender.quantity == 1 ? $defender.name : $defender.plural ) + ( killed >= 1 ? " killing " + ( $defender.quantity == 0 ? "all of them!" : killed + " " + ( killed == 1 ? $defender.name : $defender.plural ) ) : "" );
		return { killed:killed, message:msg };
	}
	*/
	/*async processCombat( $attacker, $defender ) {		
		var ret = {};
		
		if( $defender.army.length >= 1 ) {
			var log = "";
			var unit = "";
			var combat;
			
			var attackerUnits = $attacker.army.slice();
			var processedAttackers = [];
			var attackerPowerLoss = 0;
			var attackerPower = 0;
			
			var defenderUnits = $defender.army.slice();		
			var processedDefenders = [];
			var defenderPowerLoss = 0;
			var defenderPower = 0;
			
			for( var u in attackerUnits ) attackerPower += attackerUnits[ u ].power * attackerUnits[ u ].quantity;
			for( var u in defenderUnits ) defenderPower += defenderUnits[ u ].power * defenderUnits[ u ].quantity;
		
			while( attackerUnits.length > 0 || defenderUnits.length > 0 ) {				
				unit = attackerUnits.shift();
				if( unit ) {
					processedAttackers.push( unit );
					var defender = defenderUnits.length > 0 ? defenderUnits[ 0 ] : processedDefenders[ processedDefenders.length - 1 ];					
					if( defender && defender.quantity > 0 ) {
						combat = await this.processUnitCombat( unit, defender, $attacker.username, $defender.username );						
						if( combat ) {
							if( !defender.killed ) defender.killed = 0;
							defender.killed += combat.killed;
							defenderPowerLoss += defender.power * combat.killed;
							log += combat.message + "\n";
						}
					}
				}
					
				do{
					unit = defenderUnits.shift();
				} while( unit && unit.quantity <= 0 && defenderUnits.length != 0 );				
				if( unit && unit.quantity && unit.quantity > 0 ) {					
					processedDefenders.push( unit );
					var defender = processedAttackers[ processedAttackers.length - 1 ];
					if( defender && defender.quantity > 0 ) {
						combat = await this.processUnitCombat( unit, defender, $defender.username, $attacker.username );						
						if( combat ) {						
							if( !defender.killed ) defender.killed = 0;
							defender.killed += combat.killed;
							attackerPowerLoss += defender.power * combat.killed;
							log += combat.message + "\n";
						}
					}
				}
			}
			
			ret.attackerLoss = attackerPowerLoss / attackerPower;
			ret.defenderLoss = defenderPowerLoss / defenderPower;
			//Compare the ratio of lost power to determine winner
			ret.victory = ( attackerPowerLoss / attackerPower ) < ( defenderPowerLoss / defenderPower ) ? true : false;
			ret.log = log;
		} else {
			ret.victory = true;
			ret.log = "No defenders";
		}
		
		return ret;			
	}*/

	async dispatchCombatFinalized( $id, $victory, $result ) {
		var packet = {};
		packet.guid = Buffer.from( $id ).toString( "base64" );
		packet.victory = $victory;
		packet.result = $result;

		this.dispatch( "COMBAT_RESOLVED", packet );
	}

	/*
	async saveFight( $defender, $type, $victory, $log, $result ) {		
		var fid = guid.v4();
		var logQuery = "INSERT INTO fights SET guid = '" + fid + "', type = '" + $type + "', attacker = " + this.id + ", defender = " + $defender.id + ", roundid = " + this.currentRound + ", winner = " + ( $victory ? this.id : $defender.id ) + ", combat = '" + $log + "', result = '" + $result + "', time = UNIX_TIMESTAMP()";

		const connection = await this.database.beginTransaction();
		const result = await connection.query( logQuery );
		if( result && result[ 0 ].affectedRows == 1 ) {
			await this.database.commit( connection );
			this.dispatchCombatFinalized( fid, $victory, $result );
		} else {
			await this.database.rollback( connection );
			Logger.logError( "Error Saving Fight: " + loqQuery );
		}		
	}
	*/

	async constrainUnits( $id ) {
		const constrainUnitsQuery = "DELETE FROM users_rounds_units WHERE quantity <= 0 AND roundid = " + this.currentRound + " AND userid = " + $id;
		const connection = await this.database.beginTransaction();
		const result = await connection.query( constrainUnitsQuery );
		
		if( result && result[ 0 ].affectedRows == 1 ) await this.database.commit( connection );
		else await this.database.rollback( connection );
	}

	async takeLand( $from, $amount, $destroyed ) {
		if( !$destroyed ) $destroyed = 0;
		
		const connection = await this.database.beginTransaction();
		var fromQuery = "UPDATE users_rounds SET land = land - " + ( $amount + $destroyed ) + ", land_free = land_free - " + ( $amount + $destroyed ) + " WHERE userid = " + $from + " AND roundid = " + this.currentRound + " AND land >= " + $amount;
		var toQuery = "UPDATE users_rounds SET land = land + " + $amount + ", land_free = land_free + " + $amount + " WHERE userid = " + this.id + " AND roundid = " + this.currentRound;

		let result = await connection.query( fromQuery );
		if( !result || result[ 0 ].affectedRows != 1 ) {					
			await this.database.rollback( connection );
			Logger.logError( "Error Taking Land: " + fromQuery );
			return;
		}
		
		result = await connection.query( toQuery );
		if( !result || result[ 0 ].affectedRows != 1 ) {
			await this.database.rollback( connection );
			Logger.logError( "Error Taking Land: " + toQuery );
			return;
		}
		
		await this.database.commit( connection );
	}	

	async getFight( $fight ) {
		this.debug( "getFight: " + $fight );

		//Validate Input
		$fight = this.validateString( $fight );
		if( !$fight ) return this.dispatchError( "Invalid fight" );
		
		const query = "SELECT attack, type, won, time, username, log, result, fights.guid, avatar FROM ( SELECT type, guid, IF( attacker = " + this.id + ", defender, attacker) AS opponent, IF( attacker = " + this.id + ", 1, 0 ) AS attack, if( winner = " + this.id + ", 1, 0 ) AS won, combat AS log, result, time FROM fights WHERE ( attacker = " + this.id + " OR defender = " + this.id + " ) AND roundid = " + this.currentRound + " AND guid = '" + $fight + "' ORDER BY ID DESC ) as fights INNER JOIN users ON opponent = users.id";
		const fight = await this.database.getOne( query );
		if( fight ) this.dispatch( "ATTACK_RETRIEVED", fight );
		else {
			Logger.logError( "Error Retrieving Fight: " + query );
			return this.dispatchError( "No fight found" );
		}
	}

	async deleteFight( $fight ) {
		this.debug( "deleteFight: " + $fight );
		
		const fightQuery = "SELECT * FROM fights WHERE guid = '" + $fight + "' LIMIT 1";
		const fight = await this.database.getOne( fightQuery );
		if( !fight ) {
			Logger.logError( "Error Deleting Fight: " + fightQuery );
			return this.dispatchError( "Invalid fight" );
		}
					
		if( fight.roundid != this.currentRound ) return this.dispatchError( "Invalid fight" );
		if( fight.attacker != this.id && fight.defender != this.id ) return this.dispatchError( "Invalid fight" );

		const query = "UPDATE fights SET " + ( fight.attacker == this.id ? "attacker_view" : "defender_view" ) + " = 0 WHERE id = " + fight.id;
		const connection = await this.database.beginTransaction();
		const result = await connection.query( query );
		if( result && result[ 0 ].affectedRows == 1 ) {
			await this.database.commit( connection );
			this.dispatch( "FIGHT_DELETED" );
		} else {
			await this.database.rollback( connection );
			
			Logger.logError( "Error Deleting Fight: " + query );
			this.dispatchError( "Error deleting fight" );					
		}				
	}

	//==========================//
	//	Actions					//
	//==========================//
	async explore( $energy ) {
		this.debug( "explore: " + $energy );		

		//Validate energy
		if( $energy <= 0 ) return this.dispatchError( "Invalid number of energy" );
		if( $energy > this.energy ) return this.dispatchError( "Not enough energy" );
		
		this.log( "Explore: " + $energy, this.currentRound );					

		let land = await this.database.getOne( "SELECT land FROM users_rounds WHERE userid = " + this.id + " AND roundid = " + this.currentRound );
		if( !land ) {
			//Logger.logError( "Error Exploring: " + "SELECT land FROM users_rounds WHERE userid = " + this.id + " AND roundid = " + this.currentRound );							
			return this.dispatchError( "Error exploring" );
		}			
		
		//Run the calculations for land increase		
		land = parseFloat( land.land );		
		var energy = $energy;
		var gain = 0;
		var increase = 0;
		
		while( energy > 0 ) {
			if( land <= 100 ) {
				gain = Math.random() * 10 + 3;
			} else if( land <= 200 ) {
				gain = Math.random() * 7.5 + 2;
			} else if( land <= 400 ) {
				gain = Math.random() * 5 + 1.5;
			} else if( land <= 800 ) {
				gain = Math.random() * 2.5 + 1;
			} else if( land <= 1300 ) {
				gain = Math.random() * 1 + .3;
			} else if( land <= 1500 ) {
				gain = Math.random() * .5 + .2;
			} else if( land <= 2500 ) {
				gain = Math.random() * .25 + .1;
			} else {
				gain = Math.random() * .15 + .05;
			}
						
			increase += gain;
			land += gain;
			energy--;
		}
		
		const connection = await this.database.beginTransaction();
		
		//Update the user
		const commit = await connection.query( "UPDATE users_rounds SET energy = energy - " + $energy + ", energy_spent = energy_spent + " + $energy + ", land = land + " + increase + ", land_free = land_free + " + increase + " WHERE userid = " + this.id + " AND roundid = " + this.currentRound + " AND energy >= " + $energy );
		if( !commit || commit[ 0 ].affectedRows != 1 ) {
			await this.database.rollback( connection );
			
			if( !this.bot ) Logger.logError( "Error Exploring: " + "UPDATE users_rounds SET energy = energy - " + $energy + ", energy_spent = energy_spent + " + $energy + ", land = land + " + increase + ", land_free = land_free + " + increase + " WHERE userid = " + this.id + " AND roundid = " + this.currentRound + " AND energy >= " + $energy );
			return this.dispatchError( "Error exploring" );
		}
		
		//We're good, commit the transaction and release
		await this.database.commit( connection );			
		
		//Prepare the return packet
		var delta = Math.floor( this.land + increase - Math.floor( this.land ) );
		if( delta == 0 ) delta = "no";

		var data = {};
		data.msg = "You spent " + $energy + " energy exploring, and found " + delta + " acre" + ( delta == 1 ? "" : "s" ) + " of land";
		this.dispatch( "USER_EXPLORED", data );

		this.energy -= $energy;
		this.land += increase;

		this.logenergy( "explore", $energy );
		this.log( data.msg, this.currentRound );							

		this.update();							
		this.calculatePower( this.id, this.currentRound );

		this.emit( "EXPLORED" );
		return { success:true, energy:$energy };
	}

	async gather( $type, $energy ) {		
		this.debug( "gather: " + $energy + " " + $type );

		//Validate Input
		$type = this.validateString( $type );
		$energy = parseInt( $energy );

		if( !$energy || $energy <= 0 ) this.dispatchError( "Invalid energy amount" );
		if( this.energy < $energy ) this.dispatchError( "You only have " + this.energy + " energy available" );

		this.log( "Gather: " + $type + ":" + $energy, this.currentRound );

		var field = "";
		switch( $type ) {
			case "wood": field = "wood_income"; break;
			case "stone": field = "stone_income"; break;
			case "gold": field = "gold_income"; break;
			case "food": field = "food_income"; break;
			case "metal": field = "metal_income"; break;
			default:
				Logger.logError( "Can't Gather: " + $type );
				return this.dispatchError( "Invalid gather type" );				
		}

		const connection = await this.database.beginTransaction();		
		
		//Grab our current tick, set to 1 as a minimum
		let tick = await connection.query( "SELECT " + field + " AS tick FROM users_rounds WHERE userid = " + this.id + " AND roundid = " + this.currentRound );		
		tick = tick[ 0 ][ 0 ].tick;
		tick = tick < 1 ? 1 : tick;		
		
		var random = Math.floor( Math.random() * 40 ) + 80;
		var total = parseFloat( ( tick * $energy * random ) / 100.0 );

		const updateQuery = "UPDATE users_rounds SET energy = energy - " + $energy + ", energy_spent = energy_spent + " + $energy + ", " + $type + " = " + $type + " + " + total + " WHERE userid = " + this.id + " AND roundid = " + this.currentRound + " AND energy >= " + $energy + " LIMIT 1";
		let result = await connection.query( updateQuery );		
		if( !result || result[ 0 ].affectedRows != 1 ) {
			await this.database.rollback( connection );
			
			Logger.logError( "Error Gathering: " + updateQuery );
			return this.dispatchError( "Error gathering" );
		}
		
		await this.database.commit( connection );
		
		this.logenergy( "gather", $energy );
		
		var delta = Math.floor( this[ $type ] + total - Math.floor( this[ $type ] ) );
		if( delta == 0 ) delta = "no";

		var data = {};
		data.msg = "You spent " + $energy + " energy gathering, and found " + delta + " " + $type;
		data.type = $type;
		this.dispatch( "USER_GATHERED", data );

		this.log( data.msg, this.currentRound );

		this.energy -= $energy;
		this[ $type ] += total;

		var data = {};
		data.energy = Math.floor( this.energy );
		data[ $type ] = Math.floor( this[ $type ] );

		this.emit( "GATHERED" );
		this.dispatch( "USER_UPDATED", data );
		return { success:true, energy:$energy, amount:total };
	}

	async build( $type, $quantity, $restarted ) {		
		this.debug( "build: " + $quantity + " " + $type );
		
		//await this.update();		
		
		//Validate Input
		$type = this.validateString( $type );
		$quantity = parseInt( $quantity );

		if( !$quantity || $quantity <= 0 ) return this.dispatchError( "Invalid amount" );
		if( !$type ) return this.dispatchError( "Invalid building" );

		this.log( "Build: " + $type + ":" + $quantity, this.currentRound );

		if( this.landFree < $quantity ) {
			this.emit( "ERROR", "Not Enough Land" );
			return this.dispatchError( "You only have " + Math.floor( this.landFree ) + " acre" + ( Math.floor( this.landFree ) == 1 ? "" : "s" ) + " available for building" );
		}	
		
		var userQuery = "SELECT land_free AS land, build FROM users_rounds WHERE userid = " + this.id + " AND roundid = " + this.currentRound + " LIMIT 1";
		var buildingQuery = "SELECT * FROM buildings WHERE type='" + $type + "'";
		
		let userData = await this.database.getOne( userQuery );		
		if( !userData ) {
			Logger.logError( "Error Building: " + userQuery );
			return this.dispatchError( "User not found" );
		}
		if( userData.land < $quantity ) {			
			Logger.logError( "Error Building: " + userData.land + " but required " + $quantity );
			return this.dispatchError( "Not enough land" );
		}
		
		//Grab the building data
		let buildingData = await this.database.getOne( buildingQuery );		
		
		//Calculate the cost to build this
		const energy = Math.ceil( ( $quantity * buildingData.cost_points ) / userData.build );
		const wood = Math.ceil( $quantity * buildingData.cost_wood );
		const stone = Math.ceil( $quantity * buildingData.cost_stone );
		
		//Validate that we can afford it
		if( this.energy < energy ) return this.dispatchError( "You don't have enough energy" );
		if( this.wood < wood ) return this.dispatchError( "You don't have enough wood" );
		if( this.stone < stone ) return this.dispatchError( "You don't have enough stone" );

		//Declare the building queries
		const buildQuery = "UPDATE users_rounds SET land_free = land_free - " + $quantity + ", energy = energy - " + energy + ", energy_spent = energy_spent + " + energy + ", wood = wood - " + wood + ", stone = stone - " + stone + " WHERE userid = " + this.id + " AND roundid = " + this.currentRound + " AND wood >= " + wood + " AND stone >= " + stone + " AND energy >= " + energy + " AND land_free >= " + $quantity + " AND id > 0";
		const updateQuery = "UPDATE users_rounds_buildings SET quantity = quantity + " + $quantity + " WHERE userid = " + this.id + " AND roundid = " + this.currentRound + " AND buildingid = " + buildingData.id;
		const insertQuery = "INSERT INTO users_rounds_buildings SET quantity = " + $quantity + ", userid = " + this.id + ", roundid = " + this.currentRound + ", buildingid = " + buildingData.id;
		const usersBuildingsQuery = "SELECT quantity, type FROM users_rounds_buildings INNER JOIN buildings ON buildingid = buildings.id WHERE userid = " + this.id + " AND roundid = " + this.currentRound + " ORDER BY quantity DESC";				
		
		const connection = await this.database.beginTransaction();		
		//Take the cost from us
		let results = await connection.query( buildQuery );		
		if( !results || results[ 0 ].affectedRows != 1 ) {			
			await this.database.rollback( connection );
			
			Logger.logError( "Error Building: " + buildQuery );			
			return this.dispatchError( "Error building" );
		}
		
		//Update the users buildings table
		results = await connection.query( updateQuery );		
		if( !results || results[ 0 ].affectedRows != 1 ) {
			//We failed to update, okay let's insert
			try {
				results = await connection.query( insertQuery );
				if( !results || results[ 0 ].affectedRows != 1 ) {
					await this.database.rollback( connection );
					
					Logger.logError( "Error Building: " + insertQuery );
					return this.dispatchError( "Error building" );
				}
			} catch( err ) {
				await this.database.rollback( connection );
				
				Logger.logError( "DeadLock: Restarting(Building) : " + err );
				this.log( "Deadlock on Building" );
				return this.build( $type, $quantity, true );
			}
		}

		await this.database.commit( connection );
		if( $restarted ) Logger.logError( "DeadLock: Resolved" );
		
		//Build the return packet
		var msg = "Successfully built " + $quantity + " " + ( $quantity != 1 ? buildingData.plural : buildingData.name );
		this.debug( msg );
		this.updateDeltas();
		this.update();

		this.log( msg, this.currentRound );
		this.logenergy( "build", energy );
		
		let data = {};
		const buildings = await this.database.get( usersBuildingsQuery );						
		for( var b in buildings ) data[ buildings[ b ].type ] = buildings[ b ].quantity;
		this.dispatch( "BUILDINGS_BUILT", { msg:msg, buildings:data } );

		let ret = { success:true, energy:energy };
		return ret;
	}

	async recruit( $type, $quantity, $restarted ) {		
		this.debug( "recruit: " + $quantity + " " + $type );

		//Validate Input
		$type = this.validateString( $type );
		$quantity = parseInt( $quantity );
		
		if( !$quantity || $quantity <= 0 ) return this.dispatchError( "Invalid amount" );
		if( !$type ) return this.dispatchError( "Invalid unit" );		
		
		this.log( "Recruit: " + $type + ":" + $quantity, this.currentRound, true);

		let unit = UnitManager.getUnitByType( $type );		
		
		if( !unit || !unit.available ) return this.dispatchError( "Invalid unit" );
		if( !unit.recruitable ) return this.dispatchError( "Unit not recruitable" );			
		
		const userQuery = "SELECT energy, gold, population, recruit FROM users_rounds WHERE userid = " + this.id + " AND roundid = " + this.currentRound;
		let userData = await this.database.getOne( userQuery );		
		if( !userData ) { 
			Logger.logError( "Error Recruiting: " + userQuery );
			return this.dispatchError( "Error recruiting" ); 
		}
		
		var energy = Math.ceil( ( $quantity * unit.costPoints ) / userData.recruit );
		var gold = Math.ceil( $quantity * unit.costGold );

		if( userData.energy < energy ) return this.dispatchError( "Not enough energy available" );
		if( userData.gold < gold ) return this.dispatchError( "Not enough gold to recruit" );
		if( userData.population < $quantity ) return this.dispatchError( "Not enough people to recruit" );

		const updateQuery = "UPDATE users_rounds SET population = population - " + $quantity + ", energy = energy - " + energy + ", energy_spent = energy_spent + " + energy + ", gold = gold - " + gold + " WHERE userid = " + this.id + " AND roundid = " + this.currentRound + " AND gold >= " + gold + " AND energy >= " + energy + " AND population >= " + $quantity;		
		const unitUpdateQuery = "UPDATE users_rounds_units SET quantity = quantity + " + $quantity + " WHERE userid = " + this.id + " AND roundid = " + this.currentRound + " AND unitid = " + unit.id;
		const unitInsertQuery = "INSERT INTO users_rounds_units SET quantity = " + $quantity + ", userid = " + this.id + ", roundid = " + this.currentRound + ", unitid = " + unit.id;		
		const unitsQuery = "SELECT quantity, type FROM users_rounds_units INNER JOIN units ON units.id = unitid WHERE userid = " + this.id + " AND roundid = " + this.currentRound;	
		
		const connection = await this.database.beginTransaction();
		this.log( "Updating values" );
		let results = await connection.query( updateQuery );
		this.log( "Updated Values" );
		if( !results || results[ 0 ].affectedRows != 1 ) {
			await this.database.rollback( connection );
			Logger.logError( "Error Recruiting: " + updateQuery ); 
			return this.dispatchError( "Error recruiting" ); 
		}
		
		this._debug = true;
		let query = unitUpdateQuery;
		try {			
			this.log( "Trying to update unit" );
			results = await connection.query( query );
			this.log( "Update query done" );
			
			if( !results || results[ 0 ].affectedRows != 1 ) {
				this.log( "Failed, trying to insert" );
				query = unitInsertQuery;
				results = await connection.query( query );
				this.log( "RAN insert Query" );
				if( !results || results[ 0 ].affectedRows != 1 ) {
					await this.database.rollback( connection );
					
					Logger.logError( "Error Recruiting: " + unitUpdateQuery );
					return this.dispatchError( "Error recruiting" );
				}			
			}
		} catch( err ) {
			await this.database.rollback( connection );				
			
			Logger.logError( "DeadLock: Restarting(Recruiting) : " + err );
			Logger.logError( "Query: " + query );
			process.exit( -1 );
			this.log( "Deadlock on Recruiting" );
			return this.recruit( $type, $quantity, true );
		}
		this._debug = false;
		
		let updated = await this.updateExpenses( connection );
		if( !updated ) {
			await this.database.rollback( connection );
			return this.recruit( $type, $quantity, true );
		}
		
		await this.database.commit( connection );			
		this.calculatePower();		
		
		if( $restarted ) Logger.logError( "DeadLock: Resolved" );
		
		var msg = "Recruited " + $quantity + " " + ( $quantity > 1 ? unit.plural : unit.name );
		this.debug( msg );
		this.log( "UPDATE EXPENSES" );		
		this.update();

		this.log( msg, this.currentRound );
		this.logenergy( "recruit", energy );			
		
		var data = {};
		const units = await this.database.get( unitsQuery );
		for( var u in units ) data[ units[ u ].type ] = units[ u ].quantity;
		this.dispatch( "UNITS_RECRUITED", { msg:msg, units:data } );			
		
		this.emit( "RECRUITED" );
		return { success:true, energy:energy };
	}

	async getNotificationSettings() {
		this.debug( "getNotificationSettings" );		

		let packet = {};
		//packet.enabled = await

		this.dispatch( "NOTIFICATION_SETTINGS_RETRIEVED" );
	}

	async setNotificationSetting( $type, $value ) {
		this.debug( "setNotificationSetting: " + $type + " - " + $value );
		this.dispatch( "NOTIFICATION_SETTINGS_UPDATED" );
	}

	//==========================//
	//	Utility Methods			//
	//==========================//
	validateString( $val ) {
		return validator.unescape( $val );
	}

	dispatch( $msg, $data ) {
		if( this.connection ){
			this.debug( "dispatch: " + $msg );
			console.log( $data );
			this.connection.emit( $msg, $data ? $data : {} );
		}
	}

	dispatchError( $msg, $type ) {
		this.emit( "ERROR", $msg );

		if( $type ) this.dispatch( $type, $msg );
		else this.dispatch( "ERROR", $msg );
		
		return false;
	}

	debug( $msg ) {
		if( this._debug )
			Logger.logUser( $msg );
	}
}

module.exports = User;
