//=============================================================================
//  EventReader.js
//=============================================================================

/*
* Version v1.0.0
* Last updated 6/14/20

/*: 
* @author DemiDawn
* @plugindesc A Node.js module designed to provide a more efficient, convenient method to write events.
* 
* @help

  ** Overview *

This script contains two objects, the titular EventReader 
and the LogicEvaluator. 

The EventReader reads events that are expected to be formatted 
in a certain way to speed up production. More details can be 
found in extant docs.

The LogicEvaluator handles any logical statement required to replicate
the basic functions of RMMV event commands.


  ** Interface *

EventReader.readEvent()

Reads an event string stored in v_eventTemp. See extant files for a 
list of commands that can be run within an event.
*/

//=============================================================================
//  RMMV Meta
//============================================================================= 

(function () {
	
	//Setup function in case we want to split up our code further  
	function setup() {

//=============================================================================
//  Event Reader
//=============================================================================
		
		// Creating the wrapper object the user will interface with.
		function EventReader() {}
		EventReader.fs = require('fs');
		EventReader.readline = require('readline');
		EventReader.utf8 = require('utf8');
		
		// Create an object to save event states into if we need to call external RMMV commands.
		EventReader.save = {};
		
		// Create an object to store RMMV commands into.
		EventReader.rmmvCommand = null;
		
		// Define within the object the line we're currently reading.
		EventReader.curr = 0;	
		
		// Define a global container to access the event from.
		EventReader.lines = null;
		
		// The text to put before the main message, if anything.
		EventReader.pretext = "";
		
		// Records the choiceBlock. If this isn't null, it should trigger the 'readChoice' function.
		EventReader.choiceBlock = null;
		
		// The last file we saw.
		EventReader.lastSeenFile = null;
		
		// The block we're currently observing.
		EventReader.lastSeenBlock = null;
		
		// User command interface to read event files.
		EventReader.readEvent = function () {
			
			// Ensure we're in the correct mode to read messages.
			$gameMap._interpreter.setWaitMode("message");
			
			// Pull from the first variable the value to read.
			let filenameOrLines = $gameVariables.value(1);
			
			// Retrieve the file in pieces.
			if (Array.isArray(filenameOrLines)) {
				this.lines = filenameOrLines;
			} else {
				this.lastSeenFile = filenameOrLines;
				this.lines = this.__processFile(filenameOrLines).split(/\r?\n/);
			}
			
			// Process the data.
			this.__processLines();
		};
		
		// Actually does the meat of reading an event.
		// Most of what it's looping over is global, so be careful when calling this.
		EventReader.__processLines = function() {
			
			// Set the curr pointer to a saved value if it exists, then clear the saved value.
			let filenameOrLines = $gameVariables.value(1);
			if (!Array.isArray(filenameOrLines) && this.save[filenameOrLines]) {
				this.curr = this.save[filenameOrLines];
				this.save[filenameOrLines] = 0;
			} else {
				this.curr = 0;
			}
			
			// Iterate through the commands, queuing the messages.
			for (; this.curr < this.lines.length; this.curr++) {
				
				let line = this.lines[this.curr];
				if (this.__isCommand(line)) {
					
					// Use the command code to reference the correct event action.
					if (!this.commands[this.__getCommandCode(line)](this.__getCommandArgs(line), this)) {
						
						// If the command was invalid, though, print out an error.
						$gameMessage.newPage(); 
						$gameMessage.add("<WordWrap>Whoops, this isn't a recognized code: \n" +
										 this.__getCommandCode(line) +
										 "\nPlease report this to Demi ASAP to get it fixed.");
					}
				} else if (this.__isComment(line)) {
					
					// Ignore comments.
					continue;
				} else {
					
					// By default, queue a the line to display, adding any prepared pretext.
					$gameMessage.newPage();
					$gameMessage.add("<WordWrap>" + this.pretext + line);
					this.pretext = "";
				}
				
				if (this.rmmvCommand) {
					this.__popCommand();
					this.__saveEvent();
					break;
				}
			}
		};


//=============================================================================
//  Event Reader Commands
//=============================================================================
		
		// Prep the commands wrapper.
		EventReader.commands = {};
		
		// Queues a bit of text to separate messy text codes from the writing.
		EventReader.commands.pretext = function (theText, cntxt) {
			cntxt.pretext = theText;
			return true;
		};
		
		// Sets an RMMV switch.
		EventReader.commands.setSwitch = function (rawArgs, cntxt) {
			
			// Split the args into meaning chunks.
			let args = rawArgs.split(" ");
			let name = "";
			let value = null;
			
			if (args[1].toLowerCase() !== "true" && args[1].toLowerCase() !== "false") {
				throw "InvalidInputError:  cannot assign nonboolean value to switch.";
			} else {
				// The RMMV name this switch is indexed with.
				name = cntxt.__formatVar(args[0]);							
				
				// The RMMV value to change it to.
				value = (args[1].toLowerCase() === "true");	
			}
			
			// Update the value. Throw an error if the value isn't found.
			if ($dataSystem.switches.indexOf(name) === -1) {
				throw "DataNotFound: requested switch wasn't found!";
			} else {
				$gameSwitches.setValue($dataSystem["switches"].indexOf(name), value);	
			}
			
			return true;
		};
		
		// Sets an RMMV switch.
		EventReader.commands.flipSwitch = function (theSwitch, cntxt) {
			
			// Update the value. Throw an error if the value isn't found.
			let id = $dataSystem.switches.indexOf(cntxt.__formatVar(theSwitch));
			if (id === -1) {
				throw "DataNotFound: requested switch wasn't found!";
			} else {
				$gameSwitches.setValue(id, !$gameSwitches.value(id));	
			}
			
			// Confirm to the caller this worked properly.
			return true;
		};
		
		// Sets an RMMV variable.
		EventReader.commands.setVar = function (rawArgs, cntxt) {
			
			// Split the args into meaning chunks.
			let args = rawArgs.split("|");
			
			// The RMMV name this value is indexed with, trimmed for whitespace and removing single quotes.
			let name = cntxt.__formatVar(args[0]);							
			
			// The new value to set the var to.
			let updatedValue = LogicEvaluator.__evaluateLogic(args[1]);	
			
			// Update the value. Throw an error if the value isn't found.
			let varIndex = $dataSystem.variables.indexOf(name);
			if (varIndex === -1) {
				throw "DataNotFound: requested variable wasn't found!";
			} else {
				$gameVariables.setValue(varIndex, updatedValue);	
			}
			
			// Let anything using this command know it executed properly.
			return true;
		};
		
		// Begins an if statement.
		// Updates this.curr from outside the normal structure.
		EventReader.commands.stateIf = function (statement, cntxt) {
			
			// Whether we've executed a block already or not.
			let hasExecuted = false;
			
			// Loop through the statements to find the first valid if statement in the chain.
			// Simultaneously, finds the end of the if block by ending when we see the endIf command.
			while (cntxt.__getCommandCode(cntxt.lines[cntxt.curr]) !== "endIf") {
				
				// If this is a new elif statement, then change the statement to evaluate for entering the block.
				if (!hasExecuted && cntxt.__getCommandCode(cntxt.lines[cntxt.curr]) === "elif") {
					statement = cntxt.__getCommandArgs(cntxt.lines[cntxt.curr]);
				}
				
				// If this if-statement is true, run its block, then return to the block we were at before.
				let blockOpen = LogicEvaluator.__evaluateLogic(statement);
				if (!hasExecuted && typeof blockOpen === "boolean" && blockOpen) {
					cntxt.__runBlock(cntxt.__getIfBlock(cntxt.curr + 1), cntxt);
				}
				
				// Check and update our status relative to the lines.
				if (cntxt.curr === cntxt.lines.length - 1) {
					
					// If the command never hit a endIf, alert the player.
					$gameMessage.newPage(); 
					$gameMessage.add("<WordWrap>Whoops, I didn't close this if statement... \n",
									 "\nPlease report this to Demi ASAP to get it fixed.");
					break;
				} else {
					cntxt.curr++;
				}
			}
			
			// Exit the satement on the line after the endIf code.
			if (cntxt.__getCommandCode(cntxt.lines[cntxt.curr]) === "endIf") { cntxt.curr++; }
			
			return true;
		};
		
		// Begins a while statement.
		// Updates this.curr from outside the normal structure.
		EventReader.commands.stateWhile = function (statement, cntxt) {
			
			// Prep the block of code if the initial loop is valid.
			let block = [];
			if (LogicEvaluator.__evaluateLogic(statement)) { 
				block = cntxt.__getWhileBlock(cntxt.curr + 1); 
			}
			
			// Repeatedly process this block if true. 
			// May infinitely loop, if there's no exit condition.
			while (block.length > 0 && LogicEvaluator.__evaluateLogic(statement)) {
				cntxt.__runBlock(block, cntxt);
			}
			
			// Update our status relative to the lines.
			while (cntxt.__getCommandCode(cntxt.lines[cntxt.curr]) !== "endWhile") {
				if (cntxt.curr === cntxt.lines.length - 1) {
					
					// If the command never hit a whileEnd, alert the player.
					$gameMessage.newPage(); 
					$gameMessage.add("<WordWrap>Whoops, I didn't close this if statement... \n",
									 "\nPlease report this to Demi ASAP to get it fixed.");
					break;
				} else {
					cntxt.curr++;
				}
			}
			
			// Exit the satement on the line after the endWhile code.
			if (cntxt.__getCommandCode(cntxt.lines[cntxt.curr]) === "endWhile") { cntxt.curr++; }
			
			return true;
		};
		
		// Opens a new file and starts us looking at that, then returns us back to the file we were at.
		EventReader.commands.openEvent = function (filename, cntxt) {
			
			cntxt.__runBlock(cntxt.__processFile("./js/events/" + filename).split(/\r?\n/), cntxt);
			
			// Note to the outside function this ran properly.
			return true;
		};
		
		// Creates an RMMV choice. 
		// Adding 'd' to the left of a choice makes it default. Adding 'c' to the left of a choice makes it a cancel. 
		EventReader.commands.stateChoice = function (args, cntxt) {
	
			// Set the 'default' option to the first choice by default.
			let defaultOption = 0;
			
			// Turn off the 'cancel' option by default.
			let cancelOption = -1;
			
			// Construct the choices.
			args = args.split(" ");
			let choices = [];
			for (let i = 0; i < args.length; i++) {
				
				choices.push(cntxt.__formatVar(args[i]));
				
				// Check if the option is default or cancel.
				if (cntxt.__isDefault(args[i])) { defaultOption = i; }
				else if (cntxt.__isCancel(args[i])) { cancelOption = i; }
			}
			
			// Assign the choices and blocks to read on a choice.
			$gameMessage.setChoices(choices, defaultOption, cancelOption);
			let tempCurr = cntxt.curr;
			$gameMessage.setChoiceCallback(function(choice) {
				this.choiceBlock = this.__getChoiceBlock(tempCurr, choice);
			}.bind(cntxt));
			
			// Continue to keep reading after the player chooses an option.
			while (cntxt.__getCommandCode(cntxt.lines[cntxt.curr]) !== "endChoice") {
				
				// Check and update our status relative to the lines.
				if (cntxt.curr === cntxt.lines.length - 1) {
					
					// If the command never hit a endIf, alert the player.
					$gameMessage.newPage(); 
					$gameMessage.add("<WordWrap>Whoops, I didn't close this choice statement... \n",
									 "\nPlease report this to Demi ASAP to get it fixed.");
					break;
				} else {
					cntxt.curr++;
				}
			}
			
			// Prep this command to run the choice in RMMV.
			let readChoice = {
				code: 355,
				indent: $gameMap._interpreter._indent,
				parameters: ["EventReader.__readChoice();"]
			};
			cntxt.__pushCommand(readChoice);
			
			// Note to the outside function this ran properly.
			return true;
		};
		
		// Runs an RMMV Script Command.
		EventReader.commands.stateCommand = function (command, cntxt) {
	
			// Prep this command to pass to RMMV.
			let rmmvScriptCommand = {
				code: 356,
				indent: $gameMap._interpreter._indent,
				parameters: [command]
			};
			cntxt.__pushCommand(rmmvScriptCommand);
			
			// Note to the outside function this ran properly.
			return true;
		};
		
		
		
//=============================================================================
//  Event Reader Dummy Commands
//=============================================================================
		
		// The standard interpreter should never see this.
		EventReader.commands.elif = function (line) {
			$gameMessage.newPage(); 
			$gameMessage.add("<WordWrap>Whoops, this shouldn't be legally reachable: \n",
							 EventReader.__getCommandCode(line),
							 "\nPlease report the event this is in to Demi ASAP to get it fixed!");
		};
		
		// The standard interpreter should never see this.
		EventReader.commands.endIf = function (line) {
			$gameMessage.newPage(); 
			$gameMessage.add("<WordWrap>Whoops, this shouldn't be legally reachable: \n",
							 EventReader.__getCommandCode(line),
							 "\nPlease report the event this is in to Demi ASAP to get it fixed!");
		};
		
		// The standard interpreter should never see this.
		EventReader.commands.endWhile = function (line) {
			$gameMessage.newPage(); 
			$gameMessage.add("<WordWrap>Whoops, this shouldn't be legally reachable: \n",
							 EventReader.__getCommandCode(line),
							 "\nPlease report the event this is in to Demi ASAP to get it fixed!");
		};
		
		// The standard interpreter should never see this.
		EventReader.commands.endChoice = function (line) {
			$gameMessage.newPage(); 
			$gameMessage.add("<WordWrap>Whoops, this shouldn't be legally reachable: \n",
							 EventReader.__getCommandCode(line),
							 "\nPlease report the event this is in to Demi ASAP to get it fixed!");
		};
		
		
//=============================================================================
//  Event Reader Helper Functions
//=============================================================================
		
		// Runs the given block, then returns us back to running the block from before.
		EventReader.__runBlock = function(block, cntxt) {
			this.lastSeenBlock = block;
			let tempLines = cntxt.lines;
			let tempCurr = cntxt.curr;
			cntxt.lines = block;
			cntxt.__processLines();
			cntxt.lines = tempLines;
			cntxt.curr = tempCurr;
		};
		
		// Returns an array of lines that defines an if-block.
		// Valid blocks:  stateIf => elif; elif => elif; stateIf => endIf; elif => endIf
		EventReader.__getIfBlock = function (init) {
			
			// Loop until we see an ending statement or exhaust all lines.
			// Add anything that doesn't end the statement to the IfBlock.
			let block = [];
			let endSeen = false;
			for (let i = init; !endSeen && i < this.lines.length; i++) {
				
				let line = this.lines[i];
				if (this.__isCommand(line) 
				 && this.__getCommandCode(line) === "elif" 
			     || this.__getCommandCode(line) === "endIf" ) {
					endSeen = true;
				} else {
					block.push(line);
				}
			}
			
			return block;
		};
		
		// Returns an array of lines that defines a while-block.
		EventReader.__getWhileBlock = function (init) {
			
			// Loop until we see an ending statement or exhaust all lines.
			// Add anything that doesn't end the statement to the IfBlock.
			let block = [];
			let endSeen = false;
			for (let i = init; !endSeen && i < this.lines.length; i++) {
				
				let line = this.lines[i];
				if (this.__isCommand(line) && this.__getCommandCode(line) === "endWhile") {
					endSeen = true;
				} else {
					block.push(line);
				}
			}
			
			return block;
		};
		
		// Returns an array of lines that defines a choice-block.
		EventReader.__getChoiceBlock = function (init, choice) {
			
			
			// Add lines to the block until we see an ending statement or another choice.
			let block = [];
			let choiceFound = false;
			let endSeen = false;
			
			// If we're within a block of some sort, properly observe the inside of the block.
			let theLines = "";
			if (this.lastSeenBlock) {
				theLines = this.lastSeenBlock;
			} else {
				theLines = this.lines;
			}
			
			for (let i = init; !endSeen && i < theLines.length; i++) {
				
				let line = theLines[i];
				let isChoiceCommand = this.__isCommand(line) && !isNaN(this.__getCommandCode(line));
				
				if (isChoiceCommand && !choiceFound && parseInt(this.__getCommandCode(line)) === choice) {
					choiceFound = true;
				} else if ((isChoiceCommand && choiceFound || this.__getCommandCode(line) === "endChoice") && !endSeen) {
					endSeen = true;
				} else if (choiceFound) {
					block.push(line);
				}
			}
			
			return block;
		};
		
		EventReader.__getCommandCode = function (line) {
			let code = line.split(':')[0];
			return code.substring(3, code.length);
		};
		
		EventReader.__getCommandArgs = function (line) { return line.split(':')[1].trim(); };
		
		EventReader.__isCommand = function (line) {
			return line.charAt(0) === '`' && line.charAt(1) === '`' && line.charAt(2) === '`'; 
		};

		EventReader.__isComment = function (line) {
			return line === "" || line.charAt(0) === '/' && line.charAt(1) === '/'; 
		};	

		EventReader.__isCancel = function (variable) {
			return variable.endsWith("'c");
		};
		
		EventReader.__isDefault = function (variable) {
			return variable.endsWith("'d");
		};
		
		// Trims any command codes and single-quotes around variables.
		EventReader.__formatVar = function (variable) {
			if (this.__isCancel(variable)) {
				return variable.trim().replace(/'c/, "").replace(/'/g, "");
			} else if (this.__isDefault(variable)) {
				return variable.trim().replace(/'d/, "").replace(/'/g, "");
			} else {
				return variable.trim().replace(/'/g, "");
			}
		};
		
		// Allows a command to prep a command to run in RMMV.
		EventReader.__pushCommand = function (theCommand) {
			this.rmmvCommand = theCommand;
		};
		
		// Sets up the pushed command for RMMV to run.
		EventReader.__popCommand = function () {
			let nextCommand = $gameMap._interpreter._index + 1;
			$gameMap._interpreter._list[nextCommand] = this.rmmvCommand;
			$gameMap._interpreter._list[nextCommand + 1] = this.__returnToEvent;
			this.rmmvCommand = null;
		};
		
		// Saves the event data
		EventReader.__saveEvent = function () {
			this.save[this.lastSeenFile] = this.curr;
		};
		
		// Returns the gameMap back to the event command.
		EventReader.__returnToEvent = function () {
			$gameMap._interpreter._index -= 3;
		};
		
		// Reads choice contents in a separate command from runEvent.
		// Has to exist as a consequence of the way the update loop works for RMMV.
		// Essentially, after a callback, the gameMessage is cleared.
		// Anything added to it is lost, so you can't add more text. 
		EventReader.__readChoice = function () {
			$gameVariables.setValue(1, this.choiceBlock);
			this.choiceBlock = null;
		};
		
		// From Kino's tutorial. Reads a file and spits it out in utf8 format.
		EventReader.__processFile = function (filepath) {
			return this.fs.readFileSync(filepath, "utf8");
		};
		
		
//=============================================================================
//  Logic Evaluator
//=============================================================================
		
		// Design the logic evaluator:  
		// A tool for reading boolean logic for if statements and loops from RMMV templates.

		// Creating the wrapper object the user will interface with.
		function LogicEvaluator() {}
		LogicEvaluator.math = require("mathjs");
		
		// The interface function through which the event reader will evaulate 
		// logic that involves RMMV booleans.
		LogicEvaluator.__evaluateLogic = function(statement) {
			
			// If this statement has variables or switches, suss them out and replace with concrete values.
			let names = this.__nameSnip(statement);
			let values = [];
			for (let n of names) { values.push(this.__rmmvNameQuery(n)); }
			let logic = this.__nameStitch(statement, values);
			
			return this.math.evaluate(logic);
		};

		// A helper function which pulls out a variable or switch name for use.
		// Returns an array of all variable and switch names it finds.
		LogicEvaluator.__nameSnip = function(toSnip) {
			
			// Split on " ' " then evaluate every other element for whether it's a valid RMMV name.
			let diced = this.__splitLogic(toSnip);
			let names = [];
			for (let name = 1; name < diced.length - 1; name += 2) {
				if (!this.__isRMMVVar(diced[name]) && !this.__isRMMVSwitch(diced[name])) { 
					throw "TypeError:  This name doesn't follow proper var or switch naming conventions.";
				} else {
					names.push(diced[name]);
				}
			}
			
			return names;
		};

		// A helper function which queries RMMV for the var or switch information.
		LogicEvaluator.__rmmvNameQuery = function(varName) {
			
			// Query RMMV to find the relevant value.
			let result = null;
			let rmmvIndex = null;
			if (this.__isRMMVSwitch(varName)) {
				rmmvIndex = $dataSystem.switches.indexOf(varName);
				result = $gameSwitches.value($dataSystem.switches.indexOf(varName));
			} else if (this.__isRMMVVar(varName)) {
				rmmvIndex = $dataSystem.variables.indexOf(varName);
				result = $gameVariables.value($dataSystem.variables.indexOf(varName));
			} else {
				throw "DataNotFound:  the queried variable or switch wasn't found in RMMV.";
			}
			
			// If RMMV didn't find a valid entry...
			if (rmmvIndex === -1) {
				throw "TypeError:  input is not formatted as a variable or switch string!";
			} 
			
			return result;
		};

		// A helper function which stitches the queried var or switch values back into its string.
		// Expects the values to be in left to right order.
		LogicEvaluator.__nameStitch = function(toStitch, values) {
			
			// Split on " ' " then evaluate every other element for whether it's a valid RMMV name.
			let diced = this.__splitLogic(toStitch);
			
			// But before that, check to make sure that the lengths of the paired arrays make sense.
			if ((diced.length - 1) / 2 < values.length) {
				throw "ValueMismatchError:  there are too many values to stitch this string!";
			} else if ((diced.length - 1) / 2 > values.length) {
				throw "ValueMismatchError:  there aren't enough values to stitch this string!";
			}
			
			let stitched = "";
			for (let name = 0; name < diced.length; name++) {
				if (name % 2 === 0) {
					stitched += diced[name];
				} else {
					stitched += String(values[(name - 1) / 2]);
				}
			}
			
			return stitched;
		};


		// Helpers Functions:

		// A helper function which splits away RMMV names from logic strings.
		// As RMMV names are between " ' "s, on a split, they'll always be odd numbered values.
		LogicEvaluator.__splitLogic = function(statement) { return statement.split("'"); };

		// A helper function which determines if a name belongs to a var.
		LogicEvaluator.__isRMMVVar = function(name) { 
			return name.charAt(0) === 'v' && name.charAt(1) === '_';
		};

		// A helper function which determines if a name belongs to a switch.
		LogicEvaluator.__isRMMVSwitch = function(name) {
			return name.charAt(0) === 's' && name.charAt(1) === '_';
		};
		
		// Add to RMMV.
		window.LogicEvaluator = LogicEvaluator;
		window.EventReader = EventReader;
	}
	
	// Run the closure.
	setup();
})();