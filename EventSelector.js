//=============================================================================
//  EventSelector.js
//=============================================================================

/*
* Version v1.0.0
* Last updated 6/14/20
*/

/*: 
* @author DemiDawn
* @plugindesc A tool to weigh particular event metadata against each other for more precise control over event order.
* 
* @help
  ** Important *


Designed to work in tandem with the EventReader. 
MUST be placed BELOW it to use the LogicEvaluator.


  ** Overview *


This script contains two objects, the titular EventSelector 
and the EpiphanyManager. 

The EventSelector manages metadata to determine weight of
different events, then selects it all through 'chooseEvent()'.
This information must be stored in the v_eventTemp for the
EventReader to use it however.

The EpiphanyManager organizes Epiphany metadata in locksetp
with the EventSelector. This information is important for game
progression, but just as important, it is necessary for weighing
Events against each other.


  ** Interface *


EventSelector.chooseEvent()

Returns an event's filepath after determining and weighing all 
available events. To use with the EventReader, store the data
within v_eventTemp--currently set as variable 1 in RMMV. Though...
if we're smart, we'll setup everything to work based off the name
and get rid of those floating magic numbers. :P


EventSelector.isEventSeen(eventName, rmmmvVar)

After the call, whether the given event has been seen by the player 
will be stored as a boolean in the selected RMMVVar's location.
I expect to call this from within in events quite a bit.


EventSelector.newGamePlusPlus()

Adds to the persistent file a NG+. This makes it so that the player
and game can keep track of the times they're completed the story.
When a new game occurs, events the player hasn't seen in that save
file are prioritized greatly.


EventSelector.queueEvent(eventMetaName, timerInit)

Preps a given event to occur after a specific period of time. 

'1' == Next Event
'2' == After 1 Event Has Occurred
'3' == After 2 Events Have Occurred
... etc.


EpiphanyManager.updateOccurrence()

Should be called after event and action. Since the game can't
tell them apart, call these manually. Currently this function updates:

Prereqs:   Whether locked epiphanies should be unlocked.


EpiphanyManager.updateEvent()

Should be called after event. Since the game can't tell apart actions 
and events, call these manually. Currently this function updates:

Progress:  How far along epiphanies are to being unlocked.
Cadence:   Whether progress has been made toward a focused epiphany.
Focus:     The current epiphany of interest.


EpiphanyManager.dequeueEpiphany()

An epiphany that has been realized is queued for use. This function
dequeues whatever epiphany Marissa unlocked most recently, returning
its map.


EpiphanyManager.setBenefit(epiphName, bool)

Officially sets the switch that indicates that the benefit(s) of a
given epiphany have been unlocked by a player. This allows us to, in
many cases, separate unlocking the dream from the benefit. As this
is a setter, we can either turn on or off a benefit.
*/

//=============================================================================
//  RMMV Meta & Globals
//============================================================================= 

(function () {
	
	//Setup function in case we want to split up our code further  
	function setup() {
		
		// Imported modules.
		let fs = require('fs');
		let path = require('path');
		
		// Setup Global Vars
		let eventFolder = path.join(".", "js", "events");
		let epiphanyFolder = path.join(".", "js", "epiphanies");
		let inspirationReq = 3; // How many bits of inspiration are needed to hit an epiph.
		let eventFileType = ".txt";
		let epiphFileType = ".txt";
		let pFile = "persistentMeta.json";
		let noMoreEventsPath = path.join(".", "js", "specialEvents", "noMoreEvents.txt");
		let eventFormattingError = 	"It appears this event was not formatted properly.\n" +
									"Please report this to Demi to get it fixed:";
		let epiphFormattingError = 	"It appears this epiphany was not formatted properly.\n" +
									"Please report this to Demi to get it fixed:";
		let namingCollisionError = 	"It appears an epiphany and event were named the same.\n" +
									"Please report this to Demi so they can feel properly embarrased:";
									
		let jsonSpacing = 4;

//=============================================================================
//  Event Selector Persistent Data
//=============================================================================
		
		// Creating the wrapper object the user will interface with.
		function EventSelector() {};
		
		// The persistent data container.
		EventSelector.__p = {};
		
		// The event, split by line, that we're currently looking at.
		EventSelector.__p.currentEvent = [];
		
		// Each event and action, by name, that we've accessed in this save.
		EventSelector.__p.eventsOccurred = [];
		
		// The EventMeta data corresponding with all the events or actions in the event folder.
		EventSelector.__p.eventMetas = {};
		
		// Number representing the date modified of the most recent file this game has seen.
		EventSelector.__p.newestFileMTime = 0;
		
		// Files that are, from the context of the lastRan date, new.
		EventSelector.__p.newEvents = [];
		
		// Characters last used in an event.
		EventSelector.__p.prevCharacters = [];
		
		// How many times the player has replayed the game.
		EventSelector.__p.newGames = 0;
		
		// How many times a given event is mentioned in the collection of events provided.
		//	{
		//		eventName: {
		//			totalMentions: 6		// Total number of mentions between all other events.
		//			event1: 3				// Mentions found in a particular event.
		//			event2: 1
		//			event3: 2
		//		}, ...
		//	}
		EventSelector.__p.recordedMentions = {};
		
		// An array that contains QueuedEvents to ensure certain events happen in relative time.
		EventSelector.__p.eventQueue = [];


//=============================================================================
//  Event Selector RMMV Engine Modifications
//=============================================================================

		// Modifies the RMMV method called just before a save to additionally save our event data.
		let RMMVRawOnSaveSuccess = Scene_Save.prototype.onSaveSuccess;
		Scene_Save.prototype.onSaveSuccess = function(command, args) {
			RMMVRawOnSaveSuccess.call(this, command, args);
			EventSelector.__save(this.savefileId());
		}
		
		// Modifies the RMMV method called just before a load to additionally load our event data.
		let RMMVRawOnLoadSuccess = Scene_Load.prototype.onLoadSuccess;
		Scene_Load.prototype.onLoadSuccess = function(command, args) {
			RMMVRawOnLoadSuccess.call(this, command, args);
			EventSelector.__load(this.savefileId());
		}
		
		let RMMVRawSetupNewGame = DataManager.setupNewGame;
		DataManager.setupNewGame = function(command, args) {
			RMMVRawSetupNewGame.call(this, command, args);
			EventSelector.__prepStart();
			EventSelector.__start();
		}
		

//=============================================================================
//  Event Selector Interface
//=============================================================================
		
		// Collect and calibrate the EventMeta data to select a weighted event.
		EventSelector.chooseEvent = function () {
			
			// If eventMetas not prepared, initialize.
			if (this.__eventMetasUninitialized()) { this.__init(); }
			
			// Update the weights of the accessible events, then pick one.
			this.__recalibrate();
			
			// See if we have an event queued, if not, weigh the events and select one.
			let selectedEventPath = this.__checkQueue();
			if (selectedEventPath === "") { selectedEventPath = this.__weighOptions(); }
			return selectedEventPath;
		};
		
		// Store whether this event has been seen in an RMMV variable.
		// Useful for when checking in-event whether an event has been seen.
		// Expected to save information to a preallocated temporary RMMV var.
		EventSelector.isEventSeen = function(eventName, rmmmvVar) {
			temp = this.__p.eventsOccurred.includes(eventName);
			$gameVariables.setValue($dataSystem.variables.indexOf(rmmmvVar), temp);
		};
		
		// Increase the number of 'new games' played by 1.
		EventSelector.newGamePlusPlus = function() {
			this.__p.newGames++;
		};
		
		// Sets in the queue a scheduled event.
		EventSelector.queueEvent = function(eventMetaName, timerInit) {
			this.__p.eventQueue.push(new QueuedEvent(eventMetaName, timerInit));
		};
		
//=============================================================================
//  Event Selector Primary Functions
//=============================================================================

		// Helper function to prepare the starting persistent data.
		EventSelector.__prepStart = function() {
			this.chooseEvent();
			this.__p.eventsOccurred = [];
			this.__save("start");
		}
		
		// Prepares persistent data for a first run of the game so that the player has initial data preloaded.
		EventSelector.__start = function() {
			this.__load("start");
		};
		
		// Update the persistent data for the EventSelector & EpiphanyManager.
		EventSelector.__save = function(saveIndex) {
			let getPM = __getPersistentMeta.bind(this);
			let saveObj = getPM(eventFolder, saveIndex);
			saveObj[saveIndex] = this.__p;
			saveObj = JSON.stringify(saveObj, null, jsonSpacing);
			fs.writeFileSync(path.join(eventFolder, pFile), saveObj);
			EpiphanyManager.__save(saveIndex);
		};
		
		// Load in the persistent data for the EventSelector & EpiphanyManager.
		EventSelector.__load = function(saveIndex) {
			let getPM = __getPersistentMeta.bind(this);
			this.__p = getPM(eventFolder, saveIndex)[saveIndex];
			EpiphanyManager.__load(saveIndex);
			this.__clear();
		};
		
		// Initialize by running through all the events and storing them as data.
		// PRESUMES:  people aren't messing with the files while a game is running
		EventSelector.__init = function () {
			
			// Update the EventMeta data w/ new files--this is all files on first run.
			let eventPaths = __checkForNewFiles(eventFolder, 
												this.__p.newEvents, 
												this.__p.newestFileMTime,
												this.__p.eventMetas);
			this.__p.newEvents.forEach(function (file) { 
				if(file.endsWith(eventFileType)) { this.__addMeta(file, eventPaths); }  
			}.bind(EventSelector));
		};
		
		// Use collected EventMeta data to calibrate the weights.
		EventSelector.__recalibrate = function () {
			
			// For each accessible event update their metadata.
			// Must update some data fields even if inaccessible for weighting functions.
			Object.keys(this.__p.eventMetas).forEach(function(e) {
				
				// Data to preload for weighting:
				let theEventMeta = this.__p.eventMetas[e];
				this.__readEvent(e);
				theEventMeta.arc = this.__getEventArc(e);
				
				// Check accessibility, then load in data for valid events to pick.
				this.__checkEventAccessibility(theEventMeta, e);
				if (theEventMeta.isAccessible) { this.__updateEventMeta(theEventMeta, e); }
			}.bind(EventSelector));
			
			// Afer updating the metadata, calibrate the weight.
			Object.keys(this.__p.eventMetas).forEach(function(eventName) {
				let theEventMeta = this.__p.eventMetas[eventName];
				if (theEventMeta.isAccessible) { this.__considerMetaWeight(theEventMeta, eventName); }
			}.bind(EventSelector));
			
			// Recalibrate the EpiphanyManager.
			EpiphanyManager.__recalibrate();
		};
		
		// Check whether the event is accessible or not.
		EventSelector.__checkEventAccessibility = function (theEventMeta, eventName) {
			let prereqs = this.__getEventPrereqs(eventName);
			theEventMeta.prereqs = prereqs[0] ? prereqs : [];
			
			// Define a set of checks to determine what kind of prereq the string is.
			function checkPrereqs(p) {
				let eventOccurred = EventSelector.__p.eventsOccurred.includes(p);
				let epiphRealized = EpiphanyManager.__alreadyRealized(p);
				let switchFlipped = __getRMMVSwitch(p);
				let logicEvaluated = false; 
				
				if (!p.endsWith(eventFileType) && !p.startsWith("s_")) {
					logicEvaluated = LogicEvaluator.__evaluateLogic(p);
				}
				
				return eventOccurred || epiphRealized || switchFlipped || logicEvaluated;
			};
			
			theEventMeta.isAccessible = theEventMeta.prereqs.every(checkPrereqs);
		};
		
		// Check to make sure all the metadata for a given event is up to date.
		// The top of each event is presumed to begin as such:
		// '// Arc | ArcName'
		// '// Characters | NameA NameB Name C ... NameX'
		// '// Prereqs | FileNameA.txt FileNameB.txt'
		EventSelector.__updateEventMeta = function (theEventMeta, eventName) {
			
			// Update characters
			theEventMeta.characters = this.__getEventCharacters(eventName);
			
			// Update dayAccessible
			if (theEventMeta.isAccessible && theEventMeta.dayAccessible === 0) {
				theEventMeta.dayAccessible = __getRMMVVar("v_currentDay");
            }
			
			// Update mentions
			__checkForNewFiles(eventFolder, 
							   this.__p.newEvents, 
							   this.__p.newestFileMTime,
							   this.__p.eventMetas);
			if (this.__p.newEvents.length > 0) {
				
				// Update the EventMeta data for all the new mentions.
				this.__updateMentions(eventName);
				theEventMeta.mentions = this.__p.recordedMentions[eventName].totalMentions;
            }
		};
		
		// Run through all the weight functions to ensure that weight is updated.
		EventSelector.__considerMetaWeight = function (theEventMeta, eventName) {
			theEventMeta.weight = 0;
			Object.keys(this.weights).forEach(function(factor) { 
				this.weights[factor](theEventMeta, eventName); 
			}.bind(EventSelector));
		};
		
		// Decrements the first in the queue and returns it if it's ready.
		EventSelector.__checkQueue = function() {
			let queuedEvent = "";
			if (this.__p.eventQueue.length > 0) {
				let queued = this.__p.eventQueue[0];
				queued.timer--;
				if (queued.timer <= 0) {
					queuedEvent = this.__p.eventMetas[queued.eventMetaName].directory;
					this.__p.eventQueue.shift();
					this.__p.eventsOccurred.push(queuedEvent);
				}
			}
			return queuedEvent;
		};
		
		// Choose between the weighted options.
		EventSelector.__weighOptions = function () {
			
			// Prepare viable events to choose.
			let chosenEvent = noMoreEventsPath; // Set to a default message for the player.
			let weightMagnitude = 0;
			let weightedFactors = [];
			Object.keys(this.__p.eventMetas).forEach(function(eventName) {
				let theEventMeta = this.__p.eventMetas[eventName];
				if (theEventMeta.isAccessible && !this.__p.eventsOccurred.includes(eventName)) {
					weightMagnitude += theEventMeta.weight;
					weightedFactors.push({name: eventName, meta: theEventMeta});
				}
			}.bind(EventSelector));
			
			// Choose the event and reset EventMeta weights.
			let rand = Math.random() * weightMagnitude;
			console.log("Random Weight", rand);
			for (let eM of weightedFactors) {
				console.log(eM.name, eM.meta.weight, eM.meta.directory);
                if (chosenEvent === noMoreEventsPath && rand < eM.meta.weight) { 
					chosenEvent = eM.name; 
				}
				rand -= eM.meta.weight;
				eM.meta.weight = 0;
            }
			
			// Update persistent data and return the chosen event.
			if (chosenEvent !== noMoreEventsPath) {
				this.__updatePrevCharacters(this.__p.eventMetas[chosenEvent]);
				this.__p.eventsOccurred.push(chosenEvent);
			}
			
			let dir = chosenEvent
			if (this.__p.eventMetas[chosenEvent]) { dir = this.__p.eventMetas[chosenEvent].directory; }
			return dir;
		};


//=============================================================================
//  Event Selector Weight Functions
//=============================================================================
		
		// Prep the weight wrapper.
		EventSelector.weights = {};
		
		// Add more weight to events w/ characters we haven't seen.
		EventSelector.weights.preferNewCharacters = function(theEventMeta) {
			if (theEventMeta.characters.every(c => !this.__p.prevCharacters.includes(c))) {
                theEventMeta.weight += 1000;
            } else {
				theEventMeta.weight += 1;
			}
		}.bind(EventSelector);
		
		// Add more weight to an event the more mentions it has in other events.
		EventSelector.weights.preferFlavor = function(theEventMeta) {
			theEventMeta.weight += 50 * theEventMeta.mentions;
		}.bind(EventSelector);
		
		// Add more weight to an unseen event should we be on a NG+.
		EventSelector.weights.preferUnseenEvents = function(theEventMeta, eventName) {
			if (this.__p.newGames > 0 && !this.__p.eventsOccurred.includes(eventName)) {
                theEventMeta.weight += 1000000;
            } else {
				theEventMeta.weight += 1;
			}
		}.bind(EventSelector);
		
		// Add more weight to an event that's part of a shorter arc.
		EventSelector.weights.preferShorter = function(theEventMeta) {
			
			// Count events in the arc.
			let arcLength = 0;
			Object.keys(this.__p.eventMetas).forEach(function (eM) {
				arcLength += this.__p.eventMetas[eM].arc === theEventMeta.arc ? 1 : 0;
			}.bind(EventSelector));
            
			// Divide the base weight by the arc length.
			theEventMeta.weight += 500 / arcLength;
		}.bind(EventSelector);
		
		// Add more weight to an event that unlocks more events.
		EventSelector.weights.preferPotential = function(theEventMeta, eventName) {
			
			// Count times this event is used as a prereq for other events.
			let timesRequired = 0;
			Object.keys(this.__p.eventMetas).forEach(function (e) {
				timesRequired += this.__p.eventMetas[e].prereqs.includes(eventName) ? 1 : 0;
			}.bind(EventSelector));
			
			// Multiply the base weight by the times this event was required by other events.
			theEventMeta.weight += 250 * timesRequired;
		}.bind(EventSelector);
		
		// Add more weight to events that happen later in the game.
		EventSelector.weights.preferLate = function(theEventMeta) {
			theEventMeta.weight += 10 * theEventMeta.dayAccessible;
		}.bind(EventSelector);
		
		// Add a greater or lesser weight depending on whether it's been damn long since Marissa's had an epiphany.
		EventSelector.weights.modulateEpiphany = function(theEventMeta, eventName) {
			if (this.__isFocusedInspiration(eventName)) { 
				theEventMeta.weight += Math.pow(30, this.__getFocusedCadence());
			}
		}.bind(EventSelector);
		
		// Add an exhorbitant amount of weight to an event we're testing.
		// To use, must edit the JSON directly.
		EventSelector.weights.testing = function(theEventMeta) {
			if (theEventMeta.testing) { theEventMeta.weight += 133780085; }
		}.bind(EventSelector);
		
//=============================================================================
//  Event Selector Helper Functions
//=============================================================================

		// Ensures that what's being passed in is a file, then adds it to the metas list.
		EventSelector.__addMeta = function (eventName, eventPaths) {
			let filepath = eventPaths[eventName];
			let stat = fs.statSync(filepath);
			if (stat.isFile()) { this.__p.eventMetas[eventName] = new EventMeta(filepath); }
		};
		
		// For each new event, update the relevant event's mentions.
		EventSelector.__updateMentions = function (eventName) {
			
			// Count and store the mentions of a given event relative to the new event.
			let changed = false;
			this.__p.newEvents.forEach(function (e) {
				
				// Prep the dictionary of recorded mentions.
				if (!this.__p.recordedMentions[eventName]) {
					this.__p.recordedMentions[eventName] = {};
					changed = true;
				}
				if (!this.__p.recordedMentions[eventName][e]) {
					this.__p.recordedMentions[eventName][e] = 0;
					changed = true;
				}
				
				let prev = this.__p.recordedMentions[eventName][e];
				this.__p.recordedMentions[eventName][e] = this.__findMentions(eventName, this.__getEventAsStr(e));
				if (!changed && prev !== this.__p.recordedMentions[eventName][e]) {
                    changed = true;
                }
			}.bind(EventSelector));
			
			// Provided the new events changed the # of mentions,
			// Reset the total for this event, then find the new summation.
			if (changed) {
				this.__p.recordedMentions[eventName].totalMentions = 0;
				Object.keys(this.__p.recordedMentions[eventName]).forEach(function(e) {
					if (e !== "totalMentions") {
						this.__p.recordedMentions[eventName].totalMentions += this.__p.recordedMentions[eventName][e];
					}
				}.bind(EventSelector));
            }
		};
		
		// Finds the mentions within a string, then returns it.
		EventSelector.__findMentions = function (eventName, theString) {
			let matches = theString.match(new RegExp(eventName,"g")) || [];
			return matches.length;
		};

		// Reads in a particular event as the one we're currently focusing.
		EventSelector.__readEvent = function (eventName) {
			this.__p.currentEvent = this.__getEventAsStr(eventName).split(/\r?\n/);
		};
		
		// Returns an event as a string.
		EventSelector.__getEventAsStr = function (eventName) {
			return fs.readFileSync(this.__getEventDir(eventName), "utf8");
		};
		
		// Returns the stored event's directory.
		EventSelector.__getEventDir = function (eventName) {
			return this.__p.eventMetas[eventName].directory;
		};
		
		EventSelector.__eventMetasUninitialized = function () {
			return Object.keys(this.__p.eventMetas).length === 0 && this.__p.eventMetas.constructor === Object;
		};
		
		// Finds and returns the cadence of the focused epiphany.
		EventSelector.__getFocusedCadence = function () {
			let theCadence = 0;
			Object.keys(EpiphanyManager.__p.epiphanyMetas).forEach(function(e) {
				if (this.__p.focusedEpiphany === e) { theCadence = this.__p.epiphanyMetas[e].cadence; }
			}.bind(EpiphanyManager));
			return theCadence;
		};
		
		// Returns whether the given event is within the focused epiphany's inspiration list.
		EventSelector.__isFocusedInspiration = function (eventName) {
			if (EpiphanyManager.__p.focusedEpiphany !== "") {
				let theFocus = EpiphanyManager.__p.epiphanyMetas[EpiphanyManager.__p.focusedEpiphany];
				return this.__getNestedPrereqs(theFocus.inspiration).contains(eventName);
			} else {
				return false;
			}
		};
		
		// Records the characters seen in the previous event for weighting purposes.
		EventSelector.__updatePrevCharacters = function (theEventMeta) {
			this.__p.prevCharacters = theEventMeta.characters;
		};
		
		// Clears all temporary data so this is ready to be fun again.
		EventSelector.__clear = function () {
			
			// Reset the new events.
			this.__p.newEvents.length = 0;
		};
		
		// Retrieves the arc from the currently observed event.
		// To set the observed event call 'this.__readEvent(eventName);'
		EventSelector.__getEventArc = function(eventName) {
			if (this.__p.currentEvent[0].startsWith("// Arc | ")) {
				return this.__p.currentEvent[0].split(" | ")[1].trim();
			} else {
				throw eventFormattingError + " " + eventName;
			}
		};
		
		// Retrieves the characters from the currently observed event.
		// To set the observed event call 'this.__readEvent(eventName);'
		EventSelector.__getEventCharacters = function(eventName) {
			if (this.__p.currentEvent[1].startsWith("// Characters | ")) {
				return this.__p.currentEvent[1].split(" | ")[1].trim().split(" ");
			} else {
				throw eventFormattingError + " " + eventName;
			}
		};
		
		// Retrieves the prereqs from the currently observed event.
		// To set the observed event call 'this.__readEvent(eventName);'
		EventSelector.__getEventPrereqs = function(eventName) {
			if (this.__p.currentEvent[2].startsWith("// Prereqs | ")) {
				let prereqs = this.__p.currentEvent[2].split(" | ")[1].trim().split('"');
				
				// Split up the names.
				let names = [];
				for (let i = 0; i < prereqs.length; i += 2) {
					if (prereqs[i] !== "") {
						names = prereqs[i].split(" ");
					}
				}
				
				// Clean up the prereqs array to prep it for return.
				for (let i = 0; i < prereqs.length; i++) {
					let elementsToRemove = 1;
					prereqs.splice(i, elementsToRemove);
				}
				
				return prereqs.concat(names);
			} else {
				throw eventFormattingError + " " + eventName;
			}
		};
		
		// Return as an array the chain of an event's prereqs.
		EventSelector.__getNestedPrereqs = function(prereqs) {
			
			// For each prereq, check if it has prereqs.
			let delineatedPrereqs = prereqs.slice();
			
			// Then concatenate an event all its nested prereqs.
			prereqs.forEach(function(e) {
				let hasEvent = Object.keys(this.__p.eventMetas).includes(e);
				let hasEpiph = Object.keys(EpiphanyManager.__p.epiphanyMetas).includes(e);
				
				// An event and epiphany have the same name. Bad Demi.
				if (hasEvent && hasEpiph) { throw namingCollisionError; }
				
				let eMPrereqs = [];
				if (hasEvent) { 
					eMPrereqs = this.__p.eventMetas[e].prereqs;
					if (eMPrereqs.length > 0) {
						delineatedPrereqs = delineatedPrereqs.concat(this.__getNestedPrereqs(eMPrereqs)); 
					} 
				}
			}.bind(EventSelector));
			
			return delineatedPrereqs;
		};
		
		
//=============================================================================
//  Event Meta
//=============================================================================	

	// Creating a helper object containing the information the weight function needs to do its job.
	function EventMeta(theDirectory) {
		
		// How likely this object is to be chosen; higher is more likely.
		this.weight = 0;
		
		// Arc this event is a part of.
		this.arc = "";
		
		// Actors participating in this event.
		this.characters = [];
		
		// Set of events seen denoting an event's accessibility.
		this.prereqs = [];
		
		// Bool for whether the EventSelector should consider showing the player this event.
		this.isAccessible = false;
		
		// In-game day this event became one the EventSelector could access.
		this.dayAccessible = 0; 
		
		// The number of times this event is used in other events.
		this.mentions = 0; 
		
		// if we're testing this event or not.
		this.testing = false;
		
		// The directory that leads to this file.
		this.directory = theDirectory;
	}
	
	// Creating a helper object containing the information the weight function needs to do its job.
	function QueuedEvent(name, timer) {
		
		// The name of the Event Meta data that contains the directory.
		this.eventMetaName = name;
		
		// The directory that leads to this file.
		this.timer = timer;
	}
	
//=============================================================================
//  Epiphany Manager
//=============================================================================	
	
	// Creating the wrapper object the user will interface with.
	function EpiphanyManager() {}
	
	// Container for all persistent data for this object.
	EpiphanyManager.__p = {};
	
	EpiphanyManager.__p.currentEpiph = "";
	
	// Number representing the date modified of the most recent file this game has seen.
	EpiphanyManager.__p.newestFileMTime = 0;
	
	// Files that are, from the context of the lastRan date, new.
	EpiphanyManager.__p.newEpiphanies = [];
	
	// The current epiphany the game is focusing toward.
	EpiphanyManager.__p.focusedEpiphany = "";
	
	// The epiphany set to be used when Marissa next goes to sleep.
	EpiphanyManager.__p.reservedEpiphanies = [];
	
	// The epiphanies obtained through this runthrough.
	EpiphanyManager.__p.realizedEpiphanies = [];
	
	// Stores how close we are to each epiphany as well as their cadence.
	EpiphanyManager.__p.epiphanyMetas = {};
	
//=============================================================================
//  Epiphany Manager Interface
//=============================================================================
	
	// To be called after every action or event.
	EpiphanyManager.updateOccurrence = function() {
		this.__updatePrereqs();
	};
	
	// To be called after every event.
	EpiphanyManager.updateEvent = function() {
		this.__updateProgress();
		this.__updateCadence();
		this.__updateFocus();
	};
	
	// Call to set the benefit of a particular epiphany.
	// Expected to call after Marissa has completed the arc related to her epiphany.
	// Has no checks for whether the epiphany has been realized.
	EpiphanyManager.setBenefit = function(epiphName, bool) {
		let key = this.__p.epiphanyMetas[epiphName].benefit;
		__setRMMVSwitch(key, bool);
	};
	
	// Call to get the mapName of a particular epiphany and shift realizedEpiphany array.
	// Expected to call before day start when Marissa is going into her dream.
	EpiphanyManager.dequeueEpiphany = function() {
		this.__p.reservedEpiphanies.shift();
		return this.__p.epiphanyMetas[epiphName].mapName;
	};
	
//=============================================================================
//  Epiphany Manager Primary Functions
//=============================================================================
	
	// Saves the persistent epiphany data.
	EpiphanyManager.__save = function(saveIndex) {
			let getPM = __getPersistentMeta.bind(this);
			let saveObj = getPM(epiphanyFolder, saveIndex);
			saveObj[saveIndex] = this.__p;
			saveObj = JSON.stringify(saveObj, null, jsonSpacing);
			fs.writeFileSync(path.join(epiphanyFolder, pFile), saveObj);
	};
	
	// Loads any persistent epiphany data for the save.
	EpiphanyManager.__load = function(saveIndex) {
		let getPM = __getPersistentMeta.bind(this);
		this.__p = getPM(epiphanyFolder, saveIndex)[saveIndex];
	};
	
	// Sets up and ensures that epiphany static data is ready for later updates.
	EpiphanyManager.__recalibrate = function() {
		
		// If epiphanyMetas not prepared, initialize.
		if (this.__epiphMetasUninitialized()) { this.__init(); }
		
		// For each accessible event update their metadata.
		// Must update some data fields even if inaccessible for weighting functions.
		Object.keys(this.__p.epiphanyMetas).forEach(function(e) {
			
			// Data to preload for weighting:
			let eM = this.__p.epiphanyMetas[e];
			this.__readEpiph(e);
			eM.mapName = this.__getEpiphMapName(e);
			eM.benefit = this.__getEpiphBenefit(e);
			eM.pOccurrences = this.__getEpiphOccurrence(e);
			eM.pPurpose = this.__getEpiphPurpose(e);
			eM.pFlow = this.__getEpiphFlow(e);
			eM.pEnjoyment = this.__getEpiphEnjoyment(e);
			eM.inspiration = this.__getEpiphInspiration(e);
		}.bind(EpiphanyManager));
	}
	
	// Checks locked epiphanies to see if they should be unlocked.
	EpiphanyManager.__updatePrereqs = function() {
		let thoseOccurred = EventSelector.__p.eventsOccurred;
		for (let e in this.__p.epiphanyMetas) {
			let eM = this.__p.epiphanyMetas[e];
            if (eM.pOccurrences[0] === "" || eM.pOccurrences.every(o => thoseOccurred.includes(o))) {
				metPurposeReq = eM.pPurpose <= __getRMMVVar("v_purpose");
				metFlowReq = eM.pFlow <= __getRMMVVar("v_flow");
				metEnjoymentReq = eM.pEnjoyment <= __getRMMVVar("v_enjoyment");
				
				prereqsMet = metPurposeReq && metFlowReq && metEnjoymentReq;
				
				if (prereqsMet) { eM.unlocked = true; }
			}
        }
	};
	
	// Updates the progress of each epiphany whose inspiration contains the given event.
	EpiphanyManager.__updateProgress = function() {
		
		// Update and check the progress of epiphanies.
		let recentEvent = EventSelector.__p.eventsOccurred[EventSelector.__p.eventsOccurred.length - 1];
		Object.keys(this.__p.epiphanyMetas).forEach(function(e) {
			let eM = this.__p.epiphanyMetas[e];
			if (eM.hasOwnProperty("inspiration")) {
				if (!this.__alreadyRealized(e) && eM.inspiration.contains(recentEvent)) {
					eM.progress.push(recentEvent);
					
					// If any accrue enough inspiration, queue them.
					if (eM.progress.length >= inspirationReq) {
						this.__p.reservedEpiphanies.push(e);
					}
				}
            }
        }.bind(EpiphanyManager));
	};
	
	// Check the focus update its cadence.
	// If we've recently progressed, reset it. Otherwise, increment.
	EpiphanyManager.__updateCadence = function() {
		if (this.__p.focusedEpiphany !== "") {
			let recentEvent = EventSelector.__p.eventsOccurred[EventSelector.__p.eventsOccurred.length - 1];
			let theFocus = this.__p.epiphanyMetas[this.__p.focusedEpiphany];
			if (this.__inspirationProgressed(theFocus.inspiration, recentEvent)) {
				theFocus.cadence = 0;
			} else {
				theFocus.cadence++;
			}
		}
	};
	
	// Return whether the inspiration has progressed, all the way down nested requirements.
	EpiphanyManager.__inspirationProgressed = function (inspiration, recentEvent) {
		let totalInspiration = inspiration.slice();
		inspiration.forEach(function(e) {
			let hasEvent = Object.keys(EventSelector.__p.eventMetas).includes(e);
			let hasEpiph = Object.keys(this.__p.epiphanyMetas).includes(e);
			
			// An event and epiphany have the same name. Bad Demi.
			if (hasEvent && hasEpiph) { throw namingCollisionError; }
			
			let eMPrereqs = [];
			if (hasEvent) { 
				eMPrereqs = EventSelector.__p.eventMetas[e].prereqs;
				if (eMPrereqs.length > 0) {
					totalInspiration = totalInspiration.concat(EventSelector.__getNestedPrereqs(eMPrereqs));
				}
			}
		}.bind(EpiphanyManager));
		return totalInspiration.contains(recentEvent);
	};
	
	// Updates the focus checking whether it changes.
	// Find the closest epiphany to completion whos prereqs are met & sets it as the focus.
	EpiphanyManager.__updateFocus = function() {
		let recentEvent = EventSelector.__p.eventsOccurred[EventSelector.__p.eventsOccurred.length - 1];
		let closest = -1;
		let potentialFocus = [];
		Object.keys(this.__p.epiphanyMetas).forEach(function(e) {
			let theEpiphany = this.__p.epiphanyMetas[e];
			if (theEpiphany.hasOwnProperty("unlocked")) {
				if (!this.__alreadyRealized(e) && theEpiphany.unlocked) {
					let prevClosest = closest;
					closest = Math.max(theEpiphany.progress.length, closest);
					if (closest === prevClosest && closest === theEpiphany.progress.length) {
                        
						// The current epiphany is as close as we've seen. Add to the potential list.
						potentialFocus.push(e);
                    } else if (closest !== prevClosest) {
						
						// The current epiphany is greater than all the others we've seen.
						// Clear the list, then add it.
                        potentialFocus = [];
						potentialFocus.push(e);
                    }
				}
            }
        }.bind(EpiphanyManager));
		
		// Pick a random focus from the list unless it's empty. Then set the focus to blank.
		if (potentialFocus.length !== 0) {
			this.__p.focusedEpiphany = potentialFocus[Math.floor(Math.random() * potentialFocus.length)];
		} else {
			this.__p.focusedEpiphany = "";
		}
	};
	
//=============================================================================
//  Epiphany Manager Helper Methods
//=============================================================================

	// Initialize by running through all the events and storing them as data.
	// PRESUMES:  people aren't messing with the files while a game is running
	EpiphanyManager.__init = function () {
		
		// Update the EventMeta data w/ new files--this is all files on first run.
		let newEpiphPaths = __checkForNewFiles(epiphanyFolder, 
											   this.__p.newEpiphanies, 
											   this.__p.newestFileMTime, 
											   this.__p.epiphanyMetas);
		this.__p.newEpiphanies.forEach(function (file) {
			if(file.endsWith(epiphFileType)) { this.__addMeta(file, newEpiphPaths); }  
		}.bind(EpiphanyManager));
	};

	// Ensures that what's being passed in is a file, then adds it to the metas list.
	EpiphanyManager.__addMeta = function (epiphName, epiphPaths) {
		let filepath = epiphPaths[epiphName];
		let stat = fs.statSync(filepath);
		if (stat.isFile()) { this.__p.epiphanyMetas[epiphName] = new EpiphanyMeta(filepath); }
	};
	
	// Get the epiphanyMeta's directory.
	EpiphanyManager.__getEpiphDir = function (epiphName) {
		return this.__p.epiphanyMetas[epiphName].directory;
	};
	
	// Checks whether the epiphany meta exists for this yet or if it's uninitialized.	
	EpiphanyManager.__epiphMetasUninitialized = function () {
		return Object.keys(this.__p.epiphanyMetas).length === 0 && this.__p.epiphanyMetas.constructor === Object;
	};
	
	EpiphanyManager.__alreadyRealized = function(eventName) {
		return 	this.__p.realizedEpiphanies.contains(eventName) ||
				this.__p.reservedEpiphanies.contains(eventName);
	};
	
	// Reads in a particular event as the one we're currently focusing.
	EpiphanyManager.__readEpiph = function (epiphName) {
		this.__p.currentEpiph = this.__getEpiphAsStr(epiphName).split(/\r?\n/);
	};
	
	// Returns an event as a string.
	EpiphanyManager.__getEpiphAsStr = function (epiphName) {
		return fs.readFileSync(this.__getEpiphDir(epiphName), "utf8");
	};
	
	// Retrieves the mapName from the currently observed event.
	// To set the observed event call 'this.__readEpiph(epiphName);'
	EpiphanyManager.__getEpiphMapName = function(epiphName) {
		if (this.__p.currentEpiph[0].startsWith("// MapName | ")) {
			return this.__p.currentEpiph[0].split(" | ")[1].trim();
		} else {
			throw epiphFormattingError + " " + epiphName;
		}
	};
	
	// Retrieves the benefit from the currently observed event.
	// To set the observed event call 'this.__readEvent(eventName);'
	EpiphanyManager.__getEpiphBenefit = function(epiphName) {
		if (this.__p.currentEpiph[1].startsWith("// Benefit | ")) {
			return this.__p.currentEpiph[1].split(" | ")[1].trim();
		} else {
			throw epiphFormattingError + " " + epiphName;
		}
	};
	
	// Retrieves the prerequisite occurrence(s) from the currently observed event.
	// To set the observed event call 'this.__readEvent(eventName);'
	EpiphanyManager.__getEpiphOccurrence = function(epiphName) {
		if (this.__p.currentEpiph[2].startsWith("// pOccurrence | ")) {
			return this.__p.currentEpiph[2].split(" | ")[1].trim().split(" ");
		} else {
			throw epiphFormattingError + " " + epiphName;
		}
	};
	
	// Retrieves the prerequisite purpose value from the currently observed event.
	// To set the observed event call 'this.__readEvent(eventName);'
	EpiphanyManager.__getEpiphPurpose = function(epiphName) {
		if (this.__p.currentEpiph[3].startsWith("// pPurpose | ")) {
			return Number(this.__p.currentEpiph[3].split(" | ")[1].trim());
		} else {
			throw epiphFormattingError + " " + epiphName;
		}
	};
	
	// Retrieves the prerequisite flow value from the currently observed event.
	// To set the observed event call 'this.__readEvent(eventName);'
	EpiphanyManager.__getEpiphFlow = function(epiphName) {
		if (this.__p.currentEpiph[4].startsWith("// pFlow | ")) {
			return Number(this.__p.currentEpiph[4].split(" | ")[1].trim());
		} else {
			throw epiphFormattingError + " " + epiphName;
		}
	};
	
	// Retrieves the prerequisite enjoyment value from the currently observed event.
	// To set the observed event call 'this.__readEvent(eventName);'
	EpiphanyManager.__getEpiphEnjoyment = function(epiphName) {
		if (this.__p.currentEpiph[5].startsWith("// pEnjoyment | ")) {
			return Number(this.__p.currentEpiph[5].split(" | ")[1].trim());
		} else {
			throw epiphFormattingError + " " + epiphName;
		}
	};
	
	// Retrieves the prerequisite inspiriation from the currently observed event.
	// To set the observed event call 'this.__readEvent(eventName);'
	EpiphanyManager.__getEpiphInspiration = function(epiphName) {
		if (this.__p.currentEpiph[6].startsWith("// Inspiration | ")) {
			return this.__p.currentEpiph[6].split(" | ")[1].trim().split(" ");
		} else {
			throw epiphFormattingError + " " + epiphName;
		}
	};
	
	
//=============================================================================
//  Epiphany Meta
//=============================================================================	

		// Creating a helper object containing the information needed
		// to know when the epiphany should proc. Example:
		// 	{
		//		epiphany: {
		//
		//			// The name of the map that this epiphany leads to, if any.
		//			mapName: "ep_toothbrush"
		//			
		//			// The name of the benefit this epiphany unlocks. Should be a flag name.
		//			benefit: "s_toothbrush"
		//		
		//			// Events or actions that must be seen before this epiphany can proc.
		//			pOccurrences: [action1, event4],
		//			
		//			// Main game values the player must exceed to be seen before this epiphany can proc.
		//			pPurpose: 5,
		//			pFlow: 0,
		//			pEnjoyment: 20,
		//
		//			// Whether the epiphany is accessible or not.
		//			unlocked: true,
		//
		//			// Events that can contribute to this epiphany.
		//			// Plus prereqs, typically 5 are needed to reach the epiphany.
		//			inspiration: [event1, event2, event3],
		//
		//			// Events that have been seen by the player that are within inspiration.
		//			progress: [event1],
		//
		//			// Steps since the last time we've added to progress.
		//			// The higher the cadence, the more exponentially likely this event is to occur.
		//			cadence: 3
		//		}, ...
		//	}
		function EpiphanyMeta(theDirectory) {
			
			// RMMV Interfaces
			this.mapName = "unknown";
			this.benefit = "unknown";
			
			// Prerequisites
			this.pOccurrences = [];
			this.pPurpose = 0;
			this.pFlow = 0;
			this.pEnjoyment = 0;
			this.unlocked = false;
			
			// EventSelector Interfaces
			this.inspiration = []; 
			this.progress = []; 
			this.cadence = 0;
			this.directory = theDirectory;
		}
	
//=============================================================================
//  General Helper Methods
//============================================================================= 	

		// Checks the a folder for all files that changed beyond the newestFileMTime time and stores them in the newFiles.
		__checkForNewFiles = function(srcFolder, newFiles, newestFileMTime, loggedFiles) {
			
			// If we haven't already checked for new events, compare them to the newest file we've seen.
			let newNewest = 0;
			let newDirectories = {};
			if (newFiles.length === 0) {
				let processNewFiles = function(folder) {
					fs.readdirSync(folder).forEach(function (fileOrDir) {
						let filepath = path.join(folder, fileOrDir);
						let stats = fs.statSync(filepath);
						if (fileOrDir.endsWith(eventFileType)) {
							if (stats.mtimeMs > newestFileMTime) {
								newFiles.push(fileOrDir);
								newNewest = Math.max(stats.mtimeMs, newNewest);
								newDirectories[fileOrDir] = filepath;
							}
							
							let loggedDir = "unlogged";
							if (loggedFiles[fileOrDir]) { loggedDir = loggedFiles[fileOrDir].directory; }
							let filepathChanged = loggedDir && loggedDir !== filepath;
							if (filepathChanged && loggedFiles[fileOrDir]) {
								loggedFiles[fileOrDir].directory = filepath;
							}
						} else if (stats.isDirectory()) {
							processNewFiles(filepath);
						}
					}.bind(EventSelector));
				};
				
				processNewFiles(srcFolder);
            }
			
			// If a new newest file as been found, assign that as the new newest.
			newestFileMTime = Math.max(newNewest, newestFileMTime);
			return newDirectories;
		};
	
		// Reads the persistent meta file, should it exist, and returns the object contained within.
		// Assumes you are binding the caller.
		let __getPersistentMeta = function (folder, saveIndex) {
			
			let pPath = path.join(folder, pFile);
			
			// If the file doesn't already exist, create it.
			if (!fs.existsSync(pPath)) {
				let initObj = {};
				initObj[saveIndex] = this.__p;
				let newFile = JSON.stringify(initObj, null, jsonSpacing);
				fs.writeFileSync(pPath, newFile);
			}
			
			return JSON.parse(fs.readFileSync(pPath, "utf8"));
		};
		
		let __getRMMVVar = function (key) {
			return $gameVariables.value($dataSystem.variables.indexOf(key));
		};
		
		let __getRMMVSwitch = function (key) {
			return $gameSwitches.value($dataSystem.switches.indexOf(key));
		};
		
		let __setRMMVSwitch = function (key, value) {
			$gameSwitches.setValue($dataSystem.switches.indexOf(key), value);
		};
		
	
//=============================================================================
//  RMMV Footer
//============================================================================= 
		window.EventSelector = EventSelector;
		window.EpiphanyManager = EpiphanyManager;
		
	} // End setup.
	
	// Run the closure.
	setup();
})();