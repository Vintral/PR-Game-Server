var util = require("util");
var bcrypt = require( 'bcrypt' );
var bodyParser = require( 'body-parser' );
var cookies = require( 'cookie-parser' );
var session = require( 'express-session' );
var express = require( 'express' );
var fs = require( 'fs' );
var	EventEmitter = require("events").EventEmitter;

var Logger = require( './logger' );
var Security = require( './security' );

class HttpServer extends EventEmitter {
	constructor() {
		super();
		this._debug = true;
		
		this.totalUsers = 0;
		this.users = [];
		
		this.createServer();
		
		this.bcrypt = bcrypt;
	}
	
	setTotalUsers( $total ) {
		this.debug( "setTotalUsers: " + $total );
		this.totalUsers = $total;
	}

	setDatabase( $dbase ) {
		this.debug( "setself.database" );		
		this.database = $dbase;
	}

	setUsersData( $users ) {
		this.debug( "setUsersData" );
		this.users = $users;
	}

	
	//==================================//
	//	HTTP Server						//
	//==================================//
	createServer() {
		this.app = express();		

		this.app.use( bodyParser.urlencoded( { extended: true } ) );
		this.app.use( express.static( 'public' ) );
		this.app.use( cookies() );
		this.app.use( bodyParser.urlencoded( { extended: false } ) );
		this.app.use( bodyParser.json() );
		this.app.use( session( { secret:'DoomToUnbelievers!', resave:false, saveUninitialized:true } ) );
		
		var self = this;
		
		self.adminID = 0;				
			
		this.app.get( "/react", async function( request, response ) {
			var session = request.session;
			if( session && session.loggedIn ) {
				response.sendFile( 'index-react.html', { root: __dirname } );
			} else {
				response.redirect( '/login' );
			}					
		} );
		
		this.app.get( "/menu", async function( request, response ) {
			if( self.requiresSession( request, response ) ) {
				Logger.logAdmin( "menu" );
				
				let ret = [];

				const contactQuery = "SELECT COUNT(id) AS total FROM contact_submissions WHERE viewed = 0";
				const dupeQuery = "SELECT COUNT(id) AS total FROM users_dupes WHERE viewed = 0";

				let result = await self.database.execute( contactQuery );
				const contacts = result[ 0 ].total;

				result = await self.database.execute( dupeQuery );
				const dupes = result[ 0 ].total;

				ret.push( { name: "Stats" } );
				ret.push( { name: "Contacts", tag:contacts } );
				ret.push( { name: "Dupes", tag:dupes } );
				ret.push( { name: "Users" } );
				ret.push( { name: "Rounds" } );
				ret.push( { name: "Units" } );
				ret.push( { name: "Buildings" } );
				ret.push( { name: "Items" } );
				ret.push( { name: "News" } );
				ret.push( { name: "Rules" } );
				ret.push( { name: "Settings" } );
				ret.push( { name: "Theme" } );
				ret.push( { name: "Models" } );
				ret.push( { name: "Shoutbox" } );							
				
				response.write( JSON.stringify( ret ) );
				response.end();
			}
		} );
		
		this.app.get( "/dashboard/users/new", async function( request, response ) {
			if( self.requiresSession( request, response ) ) {
				//Logger.logAdmin( "Dashbord: New Users" );
				
				const data = await self.database.getOne( "SELECT COUNT(id) AS total FROM users WHERE created > UNIX_TIMESTAMP() - 86400" );
				response.write( ( data ? data.total : "0" ) + "" );
				response.end();				
			}
		} );

		this.app.get( "/dashboard/users/active", async function( request, response ) {
			if( self.requiresSession( request, response ) ) {
				//Logger.logAdmin( "Dashbord: Active Users" );
				
				response.write( server.totalUsers + "" );
				response.end();
			}
		} );

		this.app.get( "/dashboard/users/daily", async function( request, response ) {
			if( self.requiresSession( request, response ) ) {
				//Logger.logAdmin( "Dashbord: Daily Users" );
				
				const data = await self.database.getOne( "SELECT COUNT(id) AS count FROM users WHERE last_seen >= UNIX_TIMESTAMP() - 86400" );
				response.write( ( data ? data.count : "0" ) + "" );
				response.end();				
			}
		} );

		this.app.get( "/dashboard/chart/users/daily", async function( request, response ) {
			if( self.requiresSession( request, response ) ) {
				//Logger.logAdmin( "Dashbord: Chart Daily Users" );
				
				const data = await self.database.getOne( "SELECT count FROM users_daily ORDER BY id DESC LIMIT 30" );
				response.write( data ? JSON.stringify( data ) : {} );
				response.end();				
			}
		} );

		this.app.get( "/dashboard/chart/users/new", async function( request, response ) {
			var session = request.session;
			if( session && session.loggedIn ) {
				//Logger.logAdmin( "Dashbord: Chart New Users" );
				
				const data = await self.database.getOne( "SELECT users FROM users_daily_new ORDER BY id DESC LIMIT 30" );
				response.write( data ? JSON.stringify( data ) : {} );
				response.end();				
			}
		} );

		this.app.get( "/dashboard/tickets", async function( request, response ) {
			var session = request.session;
			if( session && session.loggedIn ) {
				//Logger.logAdmin( "Dashbord: Tickets" );
				
				const data = await self.database.getOne( "SELECT COUNT(id) AS total FROM contact_submissions WHERE time > UNIX_TIMESTAMP() - 86400" );				
				response.write( ( data ? data.total : "0" ) + "" );
				response.end();				
			}
		} );

		this.app.get( "/dashboard/revenue/daily", async function( request, response ) {
			var session = request.session;
			if( session && session.loggedIn ) {
				//Logger.logAdmin( "Dashbord: Daily Revenue" );
				
				response.write( "0" );
				response.end();
			}
		} );

		this.app.get( "/dashboard/revenue/monthly", async function( request, response ) {
			var session = request.session;
			if( session && session.loggedIn ) {
				//Logger.logAdmin( "Dashbord: Monthly Revenue" );
				
				response.write( "0" );
				response.end();
			}
		} );

		this.app.get( "/contacts/:page", async function( request, response ) {
			var session = request.session;
			if( session && session.loggedIn ) {
				Logger.logAdmin( "Contacts ::: " + request.params.page );

				let total = await self.database.getOne( "SELECT COUNT(id) AS total FROM contact_submissions" );				
				total = total.total;

				const page = parseInt( request.params.page );
				const perPage = 10;
				const pages = Math.ceil( total * 1.0 / perPage );

				let obj = {};
				if( page && page >= 1 ) {					
					const limitClause = "LIMIT " + ( ( page - 1 ) * perPage ) + ", " + perPage;
					const query = "SELECT contact_submissions.id, username, userid, roundid, message, time, viewed FROM contact_submissions INNER JOIN users ON users.id = userid ORDER BY contact_submissions.id DESC " + limitClause;					
					let data = await self.database.get( query );
					if( data && data.length > 0 ) {
						let ret = { pages, data };
						response.write( JSON.stringify( ret ) );
						response.statusCode = 200;
						response.end();
					} else {
						response.statusCode = 500;
						response.end();
					}
				}
			}
		} );

		this.app.get( "/contact/:id", async function( request, response ) {
			var session = request.session;
			if( session && session.loggedIn ) {
				Logger.logAdmin( "Contact ::: " + request.params.id );

				const id = parseInt( request.params.id );
				if( !id ) {
					response.statusCode = 500;
					response.end();
				}
								
				const query = "SELECT username, userid, roundid, message, time, viewed FROM contact_submissions INNER JOIN users ON users.id = userid WHERE contact_submissions.id = " + id;
				let data = await self.database.getOne( query );
				if( data ) {
					const replyQuery = "SELECT id, message, time FROM contact_submissions_replies WHERE contactid = " + id;
					let replies = await self.database.get( replyQuery );
					data.replies = replies;

					response.write( JSON.stringify( data ) );
					response.statusCode = 200;
					response.end();

					/*const updateQuery = "UPDATE contact_submissions SET viewed = 1 WHERE id = " + id;
					let result = await self.database.execute( updateQuery );
					if( !result || result.affectedRows !== 1 ) {
						Logger.logError( "ERROR: " + updateQuery );
					}*/
				} else {
					response.statusCode = 500;
					response.end();
				}
			}
		} );

		this.app.post( "/contact/:id/reply", async function( request, response ) {
			var session = request.session;
			if( session && session.loggedIn ) {
				Logger.logAdmin( "Contact Reply ::: " + request.params.id );

				const id = parseInt( request.params.id );
				if( !id ) {
					Logger.logError( "Invalid ID: " + request.params.id );
					response.statusCode = 500;
					return response.end();
				}
				
				const message = request.body.message;
				if( !message ) {
					Logger.logError( "Missing Message: " + request.body.message );
					response.statusCode = 500;
					return response.end();
				}

				const contactQuery = "SELECT userid, message FROM contact_submissions WHERE id = " + id + " LIMIT 1";
				let result = await self.database.getOne( contactQuery );
				if( !result ) {
					Logger.logError( "Invalid Contact: " + id );
					response.statusCode = 500;
					return response.end();
				}

				const userid = result.userid;
				const contactMessage = result.message;

				const replyQuery = "INSERT INTO contact_submissions_replies SET contactid = " + id + ", message = '" + message + "', time = UNIX_TIMESTAMP()";
				result = await self.database.execute( replyQuery );
				if( !result || result.affectedRows !== 1 ) {
					Logger.logError( "ERROR: Error recording contact reply - " + replyQuery );
					response.statusCode = 500;
					return response.end();
				}

				let messageBody = Buffer.from( message, "base64" ).toString() + "\n\n\n==========CONTACT==========\n\n" + Buffer.from( contactMessage, "base64" ).toString() + "\n\n==========================";
				messageBody = Buffer.from( messageBody ).toString( "base64" );
				const mailQuery = "INSERT INTO mails SET sender = 1, recipient = " + userid + ", message = '" + messageBody + "', time = UNIX_TIMESTAMP(), senderView = 1, recipientView = 1, unread = 1";
				result = await self.database.execute( mailQuery );
				if( !result || result.affectedRows !== 1 ) {
					Logger.logError( "ERROR: Sending Contact Reply: " + mailQuery );
					response.statusCode = 500;
					return response.end();
				}

				self.emit( "MAILED_USER", userid );

				const updateQuery = "UPDATE contact_submissions SET viewed = 1 WHERE id = " + id;
				result = await self.database.execute( updateQuery );

				response.statusCode = 200;
				return response.end();
			}
		} );

		this.app.get( "/dupes/:page", async function( request, response ) {
			var session = request.session;
			if( session && session.loggedIn ) {
				Logger.logAdmin( "Dupes ::: " + request.params.page );

				let total = await self.database.getOne( "SELECT COUNT(id) AS total FROM users_dupes" );
				console.log( total );
				total = total.total;

				const page = parseInt( request.params.page );
				const perPage = 30;
				const pages = Math.ceil( total * 1.0 / perPage );

				let obj = {};
				if( page && page >= 1 ) {
					//const query = "SELECT * FROM users_dupes ORDER BY id DESC LIMIT " + ( ( page - 1 ) * perPage ) + ", " + perPage;
					const limitClause = "LIMIT " + ( ( page - 1 ) * perPage ) + ", " + perPage;
					const query = "SELECT users_dupes.id, a.username AS player1, b.username AS player2, a.id AS id1, b.id AS id2, type, viewed, time FROM users_dupes INNER JOIN ( SELECT * FROM users ) AS a ON a.id = userid INNER JOIN ( SELECT * FROM users ) AS b on dupe = b.id ORDER BY users_dupes.id DESC " + limitClause;
					let data = await self.database.get( query );
					if( data && data.length > 0 ) {
						const updateQuery = "UPDATE users_dupes SET viewed = 1 WHERE id IN ( SELECT id FROM ( SELECT id FROM users_dupes ORDER BY id DESC " + limitClause + " ) AS tmp )";
						await self.database.execute( updateQuery );

						let ret = { pages, data };
						response.write( JSON.stringify( ret ) );
						response.statusCode = 200;
						response.end();
					} else {
						response.statusCode = 500;
						response.end();
					}
				}
			}
		} );

		this.app.get( "/item/:id", async function( request, response ) {
			var session = request.session;
			if( session && session.loggedIn ) {
				Logger.logAdmin( "Item ::: " + request.params.id );
				
				let obj = {};
				if( request.params.id ) {
					let data = await self.database.getOne( "SELECT * FROM items WHERE id = " + request.params.id );					
					
					obj.id = data.id;
					obj.name = data.name;
					obj.type = data.type;
					obj.level = data.level;
					obj.description = data.description;
					obj.effect = data.effect;
					obj.onUse = Security.decrypt( data.onUse );
					obj.available = data.available;
				}
								
				response.write( JSON.stringify( obj ) );
				response.end();				
			} else {
				response.statusCode = 404;
				response.end();
			}
		} );
		
		this.app.post( "/item/add", async function( request, response ) {
			var session = request.session;
			if( session && session.loggedIn ) {
				Logger.logAdmin( "Add Item" );
				
				let name = request.body.name;
				let type = request.body.type;
				let description = request.body.description;
				let effect = request.body.effect;
				let level = parseInt( request.body.level );
				let available = request.body.available ? 1 : 0;
				let onUse = Security.encrypt( Buffer.from( request.body.onUse, "base64" ).toString() );				
			
				let query = "INSERT INTO items SET name = '" + name + "', type = '" + type + "', level = " + level + ", description = '" + description + "', available = '" + available + "', effect = '" + effect + "', onUse = '" + onUse + "'";
				Logger.logAdmin( query );
				const result = await self.database.execute( query );
				if( result && result.affectedRows == 1 ) {
					Logger.logAdmin( "UPDATED ITEM" );
											
					for( var i in self.users ) {
						Logger.logAdmin( "Sent: ITEMS_DATA_UPDATED" );
						self.users[ i ].connection.emit( "ITEMS_DATA_UPDATED" );
					}
				
					self.emit( "ITEMS_UPDATED" );
					
					response.statusCode = 200;
					response.end();
				} else Logger.logError( "Error Adding Item" );
			} else {
				response.statusCode = 404;
				response.end();
			}
		} );
		
		this.app.post( "/item/:id/update", async function( request, response ) {
			var session = request.session;
			if( session && session.loggedIn ) {
				let id = request.params.id;
				
				Logger.logAdmin( "Item ::: Update " + request.params.id );
				
				let name = request.body.name;
				let type = request.body.type;
				let description = request.body.description;
				let effect = request.body.effect;
				let level = parseInt( request.body.level );
				let available = request.body.available ? 1 : 0;
				let onUse = Security.encrypt( Buffer.from( request.body.onUse, "base64" ).toString() );				
			
				let query = "UPDATE items SET name = '" + name + "', type = '" + type + "', level = " + level + ", description = '" + description + "', available = '" + available + "', effect = '" + effect + "', onUse = '" + onUse + "' WHERE id = " + id;								
				const result = await self.database.execute( query );
				if( result && result.affectedRows == 1 ) {
					Logger.logAdmin( "UPDATED ITEM" );
											
					for( var i in self.users ) {
						Logger.logAdmin( "Sent: ITEMS_DATA_UPDATED" );
						self.users[ i ].connection.emit( "ITEMS_DATA_UPDATED" );
					}
				
					self.emit( "ITEMS_UPDATED" );
					
					response.statusCode = 200;
					response.end();
				} else Logger.logError( "Error Updating Item" );
			} else {
				response.statusCode = 404;
				response.end();
			}
		} );
		
		this.app.post( "/item/:id/delete", async function( request, response ) {
			var session = request.session;
			if( session && session.loggedIn ) {
				let id = request.params.id;
								
				Logger.logAdmin( "Item ::: Delete " + request.params.id );
				
				let query = "DELETE FROM items WHERE id = " + id + " LIMIT 1";
				const result = await self.database.execute( query );
				if( result && result.affectedRows == 1 ) {					
					for( var i in self.users ) {
						Logger.logAdmin( "Sent: ITEMS_DATA_UPDATED" );
						self.users[ i ].connection.emit( "ITEMS_DATA_UPDATED" );
					}
				
					self.emit( "ITEMS_UPDATED" );
					
					response.statusCode = 200;
					response.end();
				} else Logger.logError( "Error Deleting Item: " + id );
			} else {
				response.statusCode = 404;
				response.end();
			}
		} );
		
		this.app.get( "/rounds", async function( request, response ) {
			if( self.requiresSession( request, response ) ) {
				var obj = {};
				obj.command = "rounds";
				obj.data = await self.database.get( "SELECT * FROM rounds ORDER BY active DESC, expires" );

				response.write( JSON.stringify( obj ) );
				response.end();

				Logger.logAdmin( "rounds" );
			}
		} );

		this.app.get( "/round/:id", async function( request, response ) {
			var session = request.session;
			if( session && session.loggedIn ) {
				Logger.logAdmin( "Round ::: " + request.params.id );

				let data = await self.database.getOne( "SELECT * FROM rounds WHERE id = " + request.params.id );
				var obj = {};
				obj.id = data.id;
				obj.energy = data.energy;
				obj.max_energy = data.max_energy;
				obj.land = data.land;
				obj.gold = data.gold;
				obj.food = data.food;
				obj.wood = data.wood;
				obj.stone = data.stone;
				obj.metal = data.metal;
				obj.recurring = data.recurring;
				obj.days = data.days;
				obj.players = 0;
				obj.metrics = {};
				
				data = await self.database.getOne( "SELECT COUNT(id) AS players FROM users_rounds WHERE roundid = " + request.params.id );
				obj.players = data.players;
				
				obj.metrics.energy = await self.database.get( "SELECT type, SUM( amount ) AS amount FROM metric_energy_log WHERE roundid = " + request.params.id + " GROUP BY type" );				 				
				obj.metrics.buildings = await self.database.get( "SELECT type, SUM( quantity ) AS quantity FROM users_rounds_buildings INNER JOIN buildings ON buildings.id = buildingid WHERE roundid = " + request.params.id + " GROUP BY type" );				 				
				obj.metrics.units = await self.database.get( "SELECT type, SUM( quantity ) AS quantity FROM users_rounds_units INNER JOIN units ON units.id = unitid WHERE roundid = " + request.params.id + " GROUP BY type" );
				
				
				response.write( JSON.stringify( obj ) );
				response.end();				
			} else {
				response.statusCode = 404;
				response.end();
			}
		} );

		this.app.get ( "/items", async function( request, response ) {
			if( self.requiresSession( request, response ) ) {
				var obj = {};
				obj.command = "items";
				obj.data = await self.database.get( "SELECT * FROM items ORDER BY id" );

				response.write( JSON.stringify( obj ) );
				response.end();

				Logger.logAdmin( "items" );				
			}
		} );
		
		this.app.get ( "/buildings", async function( request, response ) {
			if( self.requiresSession( request, response ) ) {
				var obj = {};
				obj.command = "buildings";
				obj.data = await self.database.get( "SELECT * FROM buildings ORDER BY id" );

				response.write( JSON.stringify( obj ) );
				response.end();

				Logger.logAdmin( "buildings" );				
			}
		} );

		this.app.get( "/buildings/:id", async function( request, response ) {
			var session = request.session;
			if( session && session.loggedIn ) {
				Logger.logAdmin( "Buildings ::: " + request.params.id );

				const data = await self.database.getOne( "SELECT * FROM buildings WHERE id = " + request.params.id );
				if( data ) {								
					var obj = {};
					obj.name = data.name;
					obj.id = data.id;
					obj.plural = data.plural;
					obj.display_position = data.display_position;
					obj.wood = data.wood;
					obj.stone = data.stone;
					obj.labor = data.labor;
					obj.field = data.field;
					obj.bonus = data.bonus;
					obj.power = data.labor;
					obj.available = data.available;

					response.write( JSON.stringify( obj ) );
					response.end();
				} else {
					response.statusCode = 404;
					response.end();
				}				
			} else {
				response.statusCode = 404;
				response.end();
			}
		} );

		this.app.post( "/buildings/update/:id", async function( request, response ) {
			var id = request.params.id;
			var name = request.body.name;
			var plural = request.body.plural;
			var wood = request.body.wood;
			var display = request.body.displayPosition;
			var stone = request.body.stone;
			var points = request.body.points;
			var field = request.body.field;
			var bonus = request.body.bonus;			
			var available = request.body.available;

			var query = "UPDATE buildings SET name='" + name + "', plural='" + plural + "', display_position = " + display + ", labor = " + points + ", wood = " + wood + ", stone = " + stone + ", field = '" + field + "', bonus = " + bonus + ", available = " + available + " WHERE id = " + id;
			Logger.logAdmin( "Buildings: Update " + id );

			const result = await self.database.execute( query );
			if( result && result.affectedRows == 1 ) {
				for( var i in self.users ) {
					Logger.logAdmin( "Sent: BUILDINGS_DATA_UPDATED" );
					self.users[ i ].connection.emit( "BUILDINGS_DATA_UPDATED" );
				}
				
				self.emit( "BUILDINGS_UPDATED" );
				
				response.statusCode = 200;
				response.end();
			}			
		} );

		this.app.get( "/units", async function( request, response ) {
			if( self.requiresSession( request, response ) ) {
				var obj = {};
				obj.command = "units";
				obj.data = new Array();
				obj.data = await self.database.get( "SELECT * FROM units ORDER BY id" );

				response.write( JSON.stringify( obj ) );
				response.end();

				Logger.logAdmin( "units" );
			}
		} );

		this.app.get( "/units/:id", async function( request, response ) {
			var session = request.session;
			if( session && session.loggedIn ) {
				Logger.logAdmin( "Units ::: " + request.params.id );

				const data = await self.database.getOne( "SELECT * FROM units WHERE id = " + request.params.id );
				if( data ) {				
					var obj = {};
					obj.id = data.id;
					obj.name = data.name;
					obj.plural = data.plural;
					obj.display_position = data.display_position;
					obj.attack = data.attack;
					obj.defense = data.defense;
					obj.health = data.health;
					obj.ranged = data.ranged;
					obj.cost = {};
					obj.cost.gold = data.cost_gold;
					obj.cost.recruit = data.cost_energy;
					obj.upkeep = {};
					obj.upkeep.gold = data.upkeep_gold;
					obj.upkeep.food = data.upkeep_food;
					obj.available = data.available;
					obj.recruitable = data.recruitable;

					response.write( JSON.stringify( obj ) );
					response.end();
				} else {
					response.statusCode = 404;
					response.end();
				}
			} else {
				response.statusCode = 404;
				response.end();
			}
		} );

		this.app.post( "/units/update/:id", async function( request, response ) {
			var id = request.params.id;
			var name = request.body.name;
			var plural = request.body.plural;
			var display = request.body.displayPosition;
			var attack = request.body.attack;
			var defense = request.body.defense;
			var health = request.body.health;
			var ranged = request.body.ranged;
			var costGold = request.body.costGold;
			var costPoints = request.body.costPoints;
			var upkeepGold = request.body.upkeepGold;
			var upkeepFood = request.body.upkeepFood;
			var available = request.body.available;
			var recruitable = request.body.recruitable;

			var query = "UPDATE units SET name='" + name + "', plural='" + plural + "', display_position = " + display + ", attack = " + attack + ", defense = " + defense + ", health = " + health + ", ranged = " + ranged + ", cost_energy = " + costPoints + ", cost_gold = " + costGold + ", upkeep_gold = " + upkeepGold + ", upkeep_food = " + upkeepFood + ", available = " + available + ", recruitable = " + recruitable + " WHERE id = " + id;

			Logger.logAdmin( "Units: Update " + id );
			
			const result = await self.database.execute( query );
			if( result && result.affectedRows == 1 ) {
				for( var i in self.users ) {
					Logger.logAdmin( "Sent: UNITS_DATA_UPDATED" );
					self.users[ i ].connection.emit( "UNITS_DATA_UPDATED" );
				}

				self.emit( "UNITS_UPDATED" );
				
				response.statusCode = 200;
				response.end();
			}
		} );

		this.app.get ( "/news", async function( request, response ) {
			var session = request.session;
			if( session && session.loggedIn ) {
				var obj = {};
				obj.command = "news";
				obj.data = await self.database.get( "SELECT * FROM news ORDER BY id DESC" );

				response.write( JSON.stringify( obj ) );
				response.end();

				Logger.logAdmin( "news" );
			} else {
				response.statusCode = 404;
				response.end();
			}
		} );

		this.app.get( "/news/:id", async function( request, response ) {
			var session = request.session;
			if( session && session.loggedIn ) {
				Logger.logAdmin( "News ::: " + request.params.id );

				const data = await self.database.getOne( "SELECT * FROM news WHERE id = " + request.params.id );
				if( data ) {				
					var obj = {};
					obj.title = data.title;
					obj.body = data.body;
					obj.id = data.id;

					response.write( JSON.stringify( obj ) );
					response.end();
				} else {
					response.statusCode = 404;
					response.end();
				}
			} else {
				response.statusCode = 404;
				response.end();
			}
		} );

		this.app.post( "/news/add", async function( request, response ) {
			var title = Buffer.from( request.body.title ).toString( "base64" );
			var body = Buffer.from( request.body.body ).toString( "base64" );
			var date = Buffer.from( request.body.date ).toString( "base64" );

			Logger.logAdmin( "Add News: " + title + " --- " + body + " --- " + date );

			const result = await self.database.execute( "INSERT INTO news SET title='" + title + "', body='" + body + "', date='" + date + "'" );
			if( result && result.affectedRows == 1 ) {						
				response.statusCode = 200;
				response.end();
			}
		} );

		this.app.post( "/news/update/:id", async function( request, response ) {
			var id = request.params.id;
			var title = Buffer.from( request.body.title );//.toString( "base64" );
			var body = Buffer.from( request.body.body );//.toString( "base64" );

			Logger.logAdmin( "News: Update " + id );
			const result = await self.database.execute( "UPDATE news SET title='" + title + "', body ='" + body + "' WHERE id = " + id );
			if( result && result.affectedRows == 1 ) {
				response.statusCode = 200;
				response.end();
			};
		} );

		this.app.get( "/news/delete/:id", async function( request, response ) {
			var session = request.session;
			if( session && session.loggedIn ) {
				var id = request.params.id;

				Logger.logAdmin( "News: Delete " + id );
				const result = await self.database.execute( "DELETE FROM news WHERE id = " + id );
				if( result && result.affectedRows == 1 ) {
					response.statusCode = 200;
					response.end();
				};
			} else {
				response.statusCode = 404;
				response.end();
			}
		} );

		this.app.get ( "/rules", async function( request, response ) {
			var session = request.session;
			if( session && session.loggedIn ) {
				var obj = {};
				obj.command = "rules";
				obj.data = await self.database.get( "SELECT * FROM rules ORDER BY position" );
				
				response.write( JSON.stringify( obj ) );
				response.end();

				Logger.logAdmin( "Rules" );					
			} else {
				response.statusCode = 404;
				response.end();
			}
		} );

		this.app.get( "/rules/:id", async function( request, response ) {
			var session = request.session;
			if( session && session.loggedIn ) {
				Logger.logAdmin( "Rules ::: " + request.params.id );

				const data = await self.database.getOne( "SELECT * FROM rules WHERE id = " + request.params.id );
				if( data ) {
					var obj = {};
					obj.position = data.position;
					obj.rule = data.rule;
					obj.id = data.id;

					response.write( JSON.stringify( obj ) );
					response.end();
				} else {
					response.statusCode = 404;
					response.end();
				}
			} else {
				response.statusCode = 404;
				response.end();
			}
		} );

		this.app.post( "/rules/add", async function( request, response ) {
			var position = request.body.position;
			var rule = Buffer.from( request.body.rule ).toString( "base64" );

			Logger.logAdmin( "Add Rule: " + position + " --- " + rule );

			const result = await self.database.execute( "INSERT INTO rules SET position='" + position + "', rule='" + rule + "'" );
			if( result && result.affectedRows == 1 ) {
				response.statusCode = 200;
				response.end();				
			} else Logger.logError( "Error Adding News" );
		} );

		this.app.post( "/rules/update/:id", async function( request, response ) {
			var session = request.session;
			if( session && session.loggedIn ) {
				var id = request.params.id;
				var position = request.body.position;
				var rule = request.body.rule;//Buffer.from( request.body.rule );//.toString( "base64" );

				Logger.logAdmin( "Rules: Update " + id + " ::: " + position );
				const result = await self.database.execute( "UPDATE rules SET position='" + position + "', rule ='" + rule + "' WHERE id = " + id );				
				if( result && result.affectedRows == 1 ) {					
					response.statusCode = 200;
					response.end();
				};
			} else {
				response.statusCode = 404;
				response.end();
			}
		} );

		this.app.get( "/rules/delete/:id", async function( request, response ) {
			var session = request.session;
			if( session && session.loggedIn ) {
				var id = request.params.id;

				Logger.logAdmin( "Rules: Delete " + id );
				const result = await self.database.execute( "DELETE FROM rules WHERE id = " + id );
				if( result && result.affectedRows == 1 ) {
					response.statusCode = 200;
					response.end();
				};
			} else {
				response.statusCode = 404;
				response.end();
			}
		} );

		this.app.get( "/users-all", async function( request, response ) {
			var session = request.session;
			if( session && session.loggedIn ) {
				var obj = {};
				obj.command = "users";
				obj.data = await self.database.get( "SELECT avatar, current_round, id, username FROM users" );

				response.write( JSON.stringify( obj ) );
				response.end();

				Logger.logAdmin( "Users" );
			} else {
				response.statusCode = 404;
				response.end();
			}
		} );

		this.app.get( "/users-search/:search", async( request, response ) => {
			const { session } = request;
			if( !session || !session.loggedIn ) {
				response.statusCode = 404;
				return response.end();
			}

			const { search } = request.params;
			Logger.logAdmin( "User Search: " + search );

			const usernameQuery = "SELECT username, avatar, id, current_round FROM users WHERE username LIKE '%" + search + "%' ORDER BY ( CASE WHEN username = '" + search + "' then 1 ELSE 0 END) + ( CASE WHEN username LIKE '" + search + "%' THEN 1 ELSE 0 END ) + ( CASE WHEN username LIKE '%" + search + "%' THEN 1 ELSE 0 END ) DESC;"
			let obj = {};
			obj.command = "users-search";
			obj.search = search;
			obj.data = await self.database.get( usernameQuery );

			const emailQuery = "SELECT username, avatar, id, current_round FROM users WHERE email LIKE '%" + search + "%' ORDER BY ( CASE WHEN email = '" + search + "' then 1 ELSE 0 END) + ( CASE WHEN email LIKE '" + search + "%' THEN 1 ELSE 0 END ) + ( CASE WHEN email LIKE '%" + search + "%' THEN 1 ELSE 0 END ) DESC;"
			let data = await self.database.get( emailQuery );
			data.forEach( d => {
				let filter = obj.data.filter( n => n.id === d.id );
				if( !filter.length ) obj.data.push( d ) 
			} );

			response.write( JSON.stringify( obj ) );
			response.end();
		} );
		
		this.app.get( "/users-online", async function( request, response ) {
			var session = request.session;
			if( session && session.loggedIn ) {
				var obj = {};
				obj.command = "users";
				obj.data = new Array();

				var list = new Array();
				for( var user in self.users ) {					
					obj.data.push( await self.database.getOne( "SELECT avatar, current_round, id, username FROM users WHERE id = " + self.users[ user ].id ) );
				}

				response.write( JSON.stringify( obj ) );
				response.end();			
			} else {
				response.statusCode = 404;
				response.end();
			}
		} );

		this.app.post( "/ban/:id", async function( request, response ) {
			let session = request.session;
			if( session && session.loggedIn ) {
				const { id } = request.params;
				Logger.logAdmin( "Ban User ::: " + id );

				// Grab all our data
				let reason = Buffer.from( request.body.reason, 'base64' ).toString( 'ascii' );
				const amount = request.body.amount;
				const unit = Buffer.from( request.body.unit, 'base64' ).toString( 'ascii' );

				// Make sure we break no queries, because we want readable database entries
				reason = reason.replace( /\'/g, "|||" );
				
				let until = "UNIX_TIMESTAMP() + ";
				switch( unit ) {
					case "minutes": until += ( amount * 60 ); break;
					case "hours": until += ( amount * 60 * 60 ); break;
					case "days": until += ( amount * 60 * 60 * 24 ); break;
					case "permanent": until = "-1"; break;
				}

				let duration = unit !== "permanent" ? amount + " " + unit : unit;

				// Build and execute the query and set status code based on the result and end the response
				const query = "INSERT INTO users_bans SET userid = " + id + ", reason = '" + reason + "', duration = '" + duration + "', until = " + until + ", date = UNIX_TIMESTAMP()";
				const result = await self.database.execute( query );
				if( !result || result.affectedRows !== 1 ) response.statusCode = 500;
				else response.statusCode = 200;

				const logQuery = "INSERT INTO users_log SET userid = " + id + ", roundid = 0, action = 'Banned: " + reason + "', time = UNIX_TIMESTAMP();";
				await self.database.execute( logQuery );

				self.emit( "BANNED_USER", id );

				response.end();
			}
		} );

		this.app.post( "/unban/:id", async function( request, response ) {
			let session = request.session;
			if( session && session.loggedIn ) {
				const { id } = request.params;
				Logger.logAdmin( "Unban User ::: " + id );

				// Set any bans until field to be before now to clear them out
				// This will at least leave a record, while lifting the effect
				const query = "UPDATE users_bans SET until = UNIX_TIMESTAMP() - 60, duration = CONCAT( duration, ' - REMOVED' ) WHERE userid = " + id + " AND ( until = -1 OR until > UNIX_TIMESTAMP() )";
				const result = await self.database.execute( query );
				if( !result || result.affectedRows === 0 ) response.statusCode = 500;
				else response.statusCode = 200;

				const logQuery = "INSERT INTO users_log SET userid = " + id + ", roundid = 0, action = 'Unbanned', time = UNIX_TIMESTAMP();";
				await self.database.execute( logQuery );

				response.end();
			}
		} );

		this.app.get( "/users/:id", async function( request, response ) {
			var session = request.session;
			if( session && session.loggedIn ) {
				const { id } = request.params;
				Logger.logAdmin( "Users ::: " + request.params.id );

				const data = await self.database.getOne( "SELECT * FROM users WHERE id = " + id );
				if( data ) {
					var obj = {};
					obj.id = data.id;
					obj.name = data.username;

					const bans = await self.database.get( "SELECT id, reason, duration, date FROM users_bans WHERE userid = " + id );
					for( let b in bans ) {
						if( !obj.bans ) obj.bans = [];

						bans[ b ].reason = bans[ b ].reason.replace( /\|\|\|/g, '\'' );
						bans[ b ].reason = Buffer.from( bans[ b ].reason ).toString( "base64" );
						obj.bans.push( bans[ b ] );
					}
					
					obj.rounds = [];
					let rounds = await self.database.get( "SELECT DISTINCT roundid FROM users_log WHERE userid = " + id );
					for( var r in rounds ) {
						obj.rounds.push( rounds[ r ].roundid );
					}
					
					if( obj.rounds.indexOf( 0 ) === -1 )
						obj.rounds.unshift( 0 );
					
					response.statusCode = 200;
					response.write( JSON.stringify( obj ) );
					response.end();
				} else {
					response.statusCode = 404;
					response.end();
				}
			} else {
				response.statusCode = 404;
				response.end();
			}
		} );

		this.app.post( "/users/update/:id", async function( request, response ) {
			var session = request.session;
			if( session && session.loggedIn ) {
				var id = request.params.id;
				var username = request.body.name;

				var query = "UPDATE users SET username = '" + username + "' WHERE id = " + id;				
				const result = await self.database.execute( query );
				if( result && result.affectedRows == 1 ) {
					response.statusCode = 200;
					response.end();
				}
			} else {
				response.statusCode = 404;
				response.end();
			}
		} );
		
		this.app.get( "/users/:id/data/:round/:type", async function( request, response ) {
			var session = request.session;
			if( session && session.loggedIn ) {
				const userid = request.params.id;
				const round = request.params.round;
				const type = request.params.type;
				
				Logger.logAdmin( "Getting User Data: " + userid + ":" + round + ":" + type );
				
				let query = "";
				switch( type ) {
					case "energy": query = "SELECT type, SUM( amount ) AS total FROM metric_energy_log WHERE userid = " + userid + " AND roundid = " + round + " GROUP BY type"; break;
					case "buildings": query = "SELECT type, SUM( quantity ) AS total FROM users_rounds_buildings INNER JOIN buildings ON buildings.id = buildingid WHERE userid = " + userid + " AND roundid = " + round + " GROUP BY buildingid"; break;
					case "units": query = "SELECT type, SUM( quantity ) AS total FROM users_rounds_units INNER JOIN units ON units.id = unitid WHERE userid = " + userid + " AND roundid = " + round + " GROUP BY unitid"; break;
					case "info": 
						query = "SELECT gold, food, metal, wood FROM users_rounds WHERE userid = " + userid + " AND roundid = " + round + " LIMIT 1";
						let data = await self.database.get( query );
						if( data ) {
							var obj = {};
							obj.data = [];
														
							data = data[ 0 ];
							
							if( !data.gold ) data.gold = 0;
							if( !data.food ) data.food = 0;
							if( !data.wood ) data.wood = 0;
							if( !data.stone ) data.stone = 0;
							if( !data.metal ) data.metal =0;
							
							obj.data.push( { type:"gold", total: data.gold, color:"#FFFF00" } );
							obj.data.push( { type:"food", total: data.food, color:"#00FF00" } );
							obj.data.push( { type:"wood", total: data.wood, color:"#6A2E02" } );
							obj.data.push( { type:"stone", total: data.stone, color:"#B9B9B9" } );
							obj.data.push( { type:"metal", total: data.metal, color:"#646464" } );
							
							response.write( JSON.stringify( obj ) );
							response.end();
						} else {
							response.statusCode = 404;
							response.end();
						}
					default:					
						response.statusCode = 404;
						response.end();
						return;
				}
				
				if( query ) {
					let data = await self.database.get( query );
					if( data ) {
						var obj = {};						
						
						for( let i = 0; i < data.length; i++ ) {
							switch( i ) {
								case 0: data[ i ].color = "#CC0000"; break;								
								case 1: data[ i ].color = "#CCCC00"; break;
								case 2: data[ i ].color = "#00CC00"; break;
								case 3: data[ i ].color = "#0000CC"; break;
								case 4: data[ i ].color = "#CC00CC"; break;
								case 5: data[ i ].color = "#00CCCC"; break;
								case 6: data[ i ].color = "#CC7777"; break;
								case 7: data[ i ].color = "#CC77CC"; break;
								case 8: data[ i ].color = "#CCCC77"; break;
								default: data[ i ].color = "#777777"; break;
							}
						}
						
						obj.data = data;
						
						response.write( JSON.stringify( obj ) );
						response.end();
					} else {
						response.statusCode = 404;
						response.end();
					}
				}
				
			} else {
				response.statusCode = 404;
				response.end();
			}
		} );
		
		this.app.get( "/users/:id/activity/:round/:page", async function( request, response ) {
			var session = request.session;
			if( session && session.loggedIn ) {
				const userid = request.params.id;
				const round = request.params.round;
				const page = parseInt( request.params.page );
				const perPage = 30;
				
				Logger.logAdmin( "Users Activity ::: " + userid + " - " + round );
			
				const query = "SELECT id,action,time FROM users_log WHERE userid = " + userid + " AND roundid = " + round + " ORDER BY id DESC LIMIT " + ( perPage * ( page - 1 ) ) + "," + perPage;
				const data = await self.database.get( query );
				if( data ) {				
					var obj = {};
					obj.data = data;
										
					let pages = await self.database.getOne( "SELECT COUNT(id) AS total FROM users_log WHERE userid = " + userid + " AND roundid = " + round );					
					obj.pages = Math.floor( pages.total / perPage ) + 1;
					obj.page = page;
					
					response.write( JSON.stringify( obj ) );
					response.end();
				} else {
					response.statusCode = 404;
					response.end();
				}
			} else {
				response.statusCode = 404;
				response.end();
			}
		} );

		this.app.get( "/stats", async function( request, response ) {
			var session = request.session;
			if( session && session.loggedIn ) {
				Logger.logAdmin( "stats" );

				var obj = {};
				obj.command = "stats";

				response.write( JSON.stringify( obj ) );
				response.end();
			} else {
				response.statusCode = 404;
				response.end();
			}
		} );

		this.app.get( '/settings', async function( request, response ) {
			var session = request.session;
			if( session && session.loggedIn ) {
				var obj = {};
				obj.command = "settings";
				obj.data = await self.database.get( "SELECT * FROM settings" );

				response.write( JSON.stringify( obj ) );
				response.end();

				Logger.logAdmin( "settings" );
			} else {
				response.statusCode = 404;
				response.end();
			}
		} );

		this.app.post( '/settings/update', async function( request, response ) {
			var setting = request.body.setting;
			var value = request.body.value ? 1 : 0;

			Logger.logAdmin( "Update Setting: " + setting + " to " + value );

			const result = await self.database.execute( "UPDATE settings SET value=" + value + " WHERE type='" + setting + "'" );
			if( result && result.affectedRows == 1 ) {				
				Logger.refresh();
				response.statusCode = 200;
				response.end();
			} else Logger.logError( "Error Updating Setting: " + setting );
		} );

		this.app.get( '/shouts/:since', async function( request, response ) {
			var since = request.params.since;
			var session = request.session;
			if( session && session.loggedIn ) {				
				var obj = {};
				obj.command = "shouts";
				obj.data = await self.database.get( "SELECT shoutbox.id, shout, time, avatar, username FROM shoutbox INNER JOIN users ON users.id = userid WHERE shoutbox.id > " + since + " ORDER BY shoutbox.id DESC LIMIT 15" );
				
				for( var s in obj.data )
					obj.data[ s ].shout = Buffer.from( obj.data[ s ].shout ).toString( "base64" );
								
				response.write( JSON.stringify( obj ) );
				response.end();
			} else {
				response.statusCode = 404;
				response.end();
			}
		} );

		this.app.get( '/shouts', async function( request, response ) {
			var session = request.session;
			if( session && session.loggedIn ) {
				var obj = {};
				obj.command = "shouts";
				obj.data = await self.database.get( "SELECT shoutbox.id, shout, time, avatar, username FROM shoutbox INNER JOIN users ON users.id = userid ORDER BY shoutbox.id DESC LIMIT 15" );
				
				for( var s in obj.data )
					obj.data[ s ].shout = Buffer.from( obj.data[ s ].shout ).toString( "base64" );
								
				response.write( JSON.stringify( obj ) );
				response.end();
			} else {
				response.statusCode = 404;
				response.end();
			}
		} );

		this.app.get( '/theme', async function( request, response ) {
			var session = request.session;
			if( session && session.loggedIn ) {
				var obj = {};
				obj.command = "theme";
				obj.data = await self.database.get( "SELECT * FROM theme ORDER BY display" );

				response.write( JSON.stringify( obj ) );
				response.end();

				Logger.logAdmin( "theme" );
			} else {
				response.statusCode = 404;
				response.end();
			}
		} );

		this.app.post( '/theme/update', async function( request, response ) {
			var field = request.body.field;
			var value = request.body.value;

			Logger.logAdmin( "Update Theme Setting: " + field + " to " + value );

			const result = await self.database.execute( "UPDATE theme SET value='" + value + "' WHERE type='" + field + "'" );
			if( result && result.affectedRows == 1 ) {
				const data = await self.database.get( "SELECT * FROM theme" );				
				if( data && data.length > 0 ) {
					var file = ":root {\n";

					for( let d in data ) {
						file += "\t" + data[ d ].type + ":";
						if( data[ d ].type == "--activeMenu" ) file += "10px solid ";
						file += data[ d ].value + ";\n";
					}

					file += "}";
					
					fs.writeFile( "/var/www/temp.hulaplatypus.com/public/css/dynamic.css", file, function(err) {
						if( err ) return Logger.logError( err );

						response.statusCode = "200";
						response.end();
					});
				}
			}			
		} );

		this.app.get( '/', async function( request, response, next ) {
			Logger.logAdmin( "home" );

			var session = request.session;
			if( session && session.loggedIn ) {
				response.sendFile( 'index.html', { root: __dirname } );
			} else {
				response.redirect( '/login' );
			}
		} );

		this.app.get( '/login', async function( request, response, next ) {
			Logger.logAdmin( "login" );

			var session = request.session;
			if( session && session.loggedIn ) {
				response.redirect( '/' );
			} else {
				response.sendFile( 'login.html', { root: __dirname } );
			}
		} );

		this.app.post( '/login', async function( request, response, next ) {		
			const data = await self.database.getOne( "SELECT * FROM users INNER JOIN roles ON userid = users.id WHERE role = 1 AND BINARY username = '" + request.body.username + "' LIMIT 1" );
			if( data ) {
				const compare = await self.bcrypt.compare( request.body.password, data.password );
				if( compare ) {					
					self.adminID++;										
					
					Logger.logAdmin( request.body.username + ' logged in' );									
					
					var session = request.session;
					session.adminID = self.adminID;
					session.username = request.body.username;
					session.loggedIn = true;
					response.redirect( '/react' );
				} else {
					Logger.logError( request.body.username + ' failed to login to admin' );
					response.redirect( '/login' );
				}
			} else {
				Logger.logError( request.body.username + ' failed to login to admin' );
				response.redirect( '/login' );
			}					
		} );

		this.app.get ( '/logout', async function( request, response, next ) {
			var session = request.session;
			var username = '';

			if( request.session && request.session.username ) username = request.session.username;

			request.session.destroy( function( err ) {
				if( username ) Logger.logAdmin( username + ' logged out' );

				request.session = null;
				response.redirect( '/login' );
			} );
		} );
	}
	
	requiresSession( request, response ) {
		//Logger.logAdmin( "requiresSession" );
		
		var session = request.session;
		if( !session || !session.loggedIn ) {		
			response.statusCode = 404;
			response.end();
			return false;
		}
		
		return true;
	}
	
	debug( $msg ) {		
		Logger.logAdmin( $msg );
	}
}

var server = new HttpServer();

module.exports = server;
