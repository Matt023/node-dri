/**
 * @author mvanwamb
 * @author Quirijn Groot Bluemink
 */
var fedora = require("fedora")
var mongoose = require("mongoose")
var schemas = require("./dri-schemas")
var converter = require("./data-converters");
var winston = require("winston");

var util = require('util')
var mime = require("mime")
var fs = require("node-fs");
var crypto = require("crypto");
var dri = this

// Configuration info recieved from the configuration module
var config

// Configuration data is recieved from the parent package and stored locally
// This function must be called when starting up the application
exports.configure = function configure(config) {
	this.config = config
	schemas.connectMongoose(this.config.mongoDBURL)
	fedora.configure(config)
	winston.log("info", "DRI package configured")
}


exports.fedora = fedora;

/*
 Function: getChildren

 Gets all the children of this object

 Parameters:

 id - mongo id of the object
 callback - callback function

 Returns:

 array of the corresponding objects.
 */
exports.getChildren = function getChildren(id, page, amount, onSuccess, onError) {

	var numPages
	schemas.driObject.find({
		parentId : id
	}).count(function(err, count) {
		numPages = Math.ceil(count / amount)
	}).skip(page * amount).limit(amount).execFind(function(err, doc) {
		if(err) {
			winston.log("error", err)
			onError(err)
		} else {
			winston.log("info", "Fetched items")
			onSuccess(doc, numPages)
		}
	})
}


/*
 Function: getObject

 Get the object with the ID

 Parameters:

 id - mongo id of the object
 onSuccess - callback function when successfull
 onError - callback function when error occurs

 Returns:

 data array of the object
 */
exports.getObject = function(id, onSuccess, onError) {
	schemas.driObject.findById(id, function(err, doc) {
		if(err) {
			winston.log("error", err)
			onError(err)
		} else {
			onSuccess(doc)
		}
	})
}


/*
 Function: createObject

 Creates a new object with the given data

 Parameters:

 data - data for the new object
 onSuccess - callback function when successfull
 onError - callback function when error occurs

 Returns:

 ID of the newly created object
 */
exports.createObject = function(data, onSuccess, onError) {
	// Create new hash
	var hash = createSha1Hash()
	data.label = hash
	var newItem = new schemas.driObject(data)

	newItem.save(function(err, data) {
		if(err) {
			winston.log("error", err)
			onError(err)
		} else {
			//winston.log("info","Success")
			onSuccess(data._id.toString())
		}
	})
}


/*
 Function: updateObject

 Updates an object

 Parameters:

 id - ID of the object to be update
 body - the new set of data for the object
 onSuccess - callback function when successfull
 onError - callback function when error occurs

 Returns:

 Number of affected objects
 */
exports.updateObject = function(id, body, onSuccess, onError) {
	var conditions = {
		_id : id
	}, update = body, options = {
		multi : false
	}

	schemas.driObject.update(conditions, update, options, function(err, numAffected) {
		if(err) {
			winston.log("error", err)
			onError(err)
		} else {
			onSuccess(numAffected)
		}
	})
}


/*
 Function: removeObject

 Removes an object

 Parameters:

 id - ID of the object to be deleted
 onSuccess - callback function when successfull
 onError - callback function when error occurs

 Returns:

 ID of the deleted object
 */
exports.removeObject = function(id, onSuccess, onError) {
	this.getObject(id, function(result) {
		result.remove()
		onSuccess(result._id)
	}, function(err) {
		winston.log("error", err)
		onError(err)
	})
}


/*
 Function: getObjectTypes

 Returns all the different types an object can be

 Parameters:

 onSuccess - callback function when successfull
 onError - callback function when error occurs

 Returns:

 An array containing the types
 */
exports.getObjectTypes = function getObjectTypes(onSuccess, onError) {
	if(schemas.driTypes) {
		onSuccess(schemas.driTypes)
	} else {
		winston.log("error", "No data")
		onError("No data")
	}
}


/*
 Function: approveItem

 Approves an item. Retrieves the item from MongoDB and ingests it
 into the Fedora repository

 Parameters:

 id - ID of the item to be approved
 onSuccess - callback function when successfull
 onError - callback function when error occurs

 Returns:

 pID of the approved item
 */
exports.approveItem = function approveItem(id, namespace, onSuccess, onError) {
	var item = ''
	this.getObject(id, function(data) {
		fedora.createFedoraObject(namespace, data.properties.titleInfo.title, function(response) {
			var pid = response;
			var dc = dri.convertToDC(data)
			fedora.addXMLDatastream(pid, "DC", dc, function(result) {
				data.fedoraId = pid
				//winston.log("info",data)
				//winston.log("info",data.fileLocation)
				if(data.fileLocation != undefined) {
					winston.log("info", "Oh hai file!")
					fedora.addMediaDatastream(pid, "MEDIA", data, function(result) {
						winston.log("info", result)
						data.fedoraId = pid
						onSuccess(pid)
					}, function(e) {
						winston.log("error", e)
						onError(e)
					})
				} else {
					onSuccess(pid)
				}
			}, function(e) {
				winston.log("error", e)
				onError(e)
			})
		}, function(e) {
			winston.log("error", e)
			onError(e)
		})
	}, function(err) {
		winston.log("error", err)
		onError(err)
	})
}


/*
 Function: convertToDC

 Converts the JSON to Dublin Core

 Parameters:

 json - The JSON to be converted to DC

 Returns:

 A string of Dublin Core
 */
exports.convertToDC = function converToDC(json) {
	return converter.toDC(json)
}


/*
 Function: convertToMODS

 Converts the JSON to MODS

 Parameters:

 json - The JSON to be converted to MODS

 Returns:

 A string of MODS
 */
exports.convertToMODS = function converToMODS(json) {
	return converter.toMODS(json)
}


// Creates the given path
function createDirectory(path, uploadDirectory, onSuccess, onError) {
	fs.mkdir(uploadDirectory + path, 0700, true, function(err) {
		if(err) {
			winston.log("error", err)
			onError(err)
		} else {
			onSuccess(1)
		}
	});
}


/*
 Function: uploadFile

 Takes the uploaded files and stores them in the location declared in the configuration file

 Parameters:

 files - The files from the request

 Returns:

 The path to the directory of the stored files
 */
exports.uploadFile = function uploadFile(files, onSuccess, onError) {
	var dri = this

	var uid = createSha1Hash()

	// Add to the directory path
	var fileDirectory = dri.config.uploadDirectory + uid + "/"

	if(files.size != 0) {
		createDirectory('', fileDirectory, function() {
			var is = fs.createReadStream(files.path)
			var os = fs.createWriteStream(fileDirectory + files.name);

			util.pump(is, os, function() {
				fs.unlink(files.path, function(err) {
					if(err) {
						winston.log("error", err)
						onError(err)
					}
					onSuccess(uid + "/" + files.name);
				});
			});
		}, function(err) {
			winston.log("error", err)
			onError(err)
		})
	} else {
		winston.log("info", "No files")
		onError("No files")
	}
}


// Creates a sha1 hash
function createSha1Hash() {
	var hash = crypto.createHash("sha1")
	var time = new Date().getTime();
	var veryrandom = time * Math.random()
	hash.update(veryrandom.toString())
	var uid = hash.digest('hex')
	return uid
}


/*
 Function: countObjects

 Uses the given option, and counts the amount of objects

 Parameters:

 options - a Json object containing the options

 Returns:

 The amount of objects
 */
exports.countObjects = function countObjects(options, onSuccess, onError) {
	schemas.driObject.count(options, function(err, doc) {
		if(err) {
			winston.log("error", err)
			onError(err)
		} else {
			onSuccess(doc)
		}
	})
}


/*
 Function: query

 Uses the field and value to find objects that contain this information

 Parameters:

 field - The field of the object to search for
 value - The value of the field to search for

 Returns:

 An array containing all the objects
 */
exports.query = function query(field, value, onSuccess, onError) {
	var patt = new RegExp('^' + value, 'i')
	//winston.log("info","Searching " + value + " in " + field)
	var options = '{"' + field + '":{"$regex":"' + value + '", "$options": "i"}}'

	options = JSON.parse(options)
	//winston.log("info",options)
	schemas.driObject.find(options, function(err, doc) {
		if(err) {
			winston.log("error", err)
			onError(err)
		} else {
			onSuccess(doc)
		}
	})
}


exports.lastCreated = function lastCreated(onSuccess, onError) {
	schemas.driObject.find().sort('dateCreated', -1).limit(5).execFind(function(err, doc) {
		if(err) {
			winston.log("error", err)
			onError(err)
		} else {
			onSuccess(doc)
		}

	});
}


exports.lastCreatedByType = function lastCreatedByType(objType, onSuccess, onError) {
	schemas.driObject.find({
		type : objType
	}).sort('dateCreated', -1).limit(5).execFind(function(err, doc) {
		if(err) {
			winston.log("error", err)
			onError(err)
		} else {
			onSuccess(doc)
		}

	});
}


exports.lastEdited = function lastEdited(onSuccess, onError) {
	schemas.driObject.find({
		dateModified : {
			$exists : true
		}
	}).sort('dateModified', -1).limit(5).execFind(function(err, doc) {
		if(err) {
			winston.log("error", err)
			onError(err)
		} else {
			onSuccess(doc)
		}

	});
}


exports.lastEditedByType = function lastEditedByType(objType, onSuccess, onError) {
	schemas.driObject.find({
		type : objType,
		dateModified : {
			$exists : true
		}
	}).sort('dateModified', -1).limit(5).execFind(function(err, doc) {
		if(err) {
			winston.log("error", err)
			onError(err)
		} else {
			onSuccess(doc)
		}

	});
}
