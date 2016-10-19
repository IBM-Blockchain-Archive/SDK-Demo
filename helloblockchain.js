var hfc = require('hfc');
var util = require('util');
var fs = require('fs');
const https = require('https');

// Create a client blockchin.
var chain = hfc.newChain("targetChain");

// Creating an environment variable for ciphersuites
process.env['GRPC_SSL_CIPHER_SUITES'] = 'ECDHE-RSA-AES128-GCM-SHA256:' +
    'ECDHE-RSA-AES128-SHA256:' +
    'ECDHE-RSA-AES256-SHA384:' +
    'ECDHE-RSA-AES256-GCM-SHA384:' +
    'ECDHE-ECDSA-AES128-GCM-SHA256:' +
    'ECDHE-ECDSA-AES128-SHA256:' +
    'ECDHE-ECDSA-AES256-SHA384:' +
    'ECDHE-ECDSA-AES256-GCM-SHA384';

var ccPath = '';
if (process.argv.length != 4) {
    console.log("Invalid arguments");
    console.log("USAGE: node helloblockchain.js -c <chaincode-dir-name>");
    console.log("ex: ");
    console.log("node helloblockchain.js -c chaincode_example02");
    process.exit();
}
process.argv.forEach(function(val, index, array) {
    if (index == 2 && (!val || val != "-c")) {
        console.log("Invalid arguments")
        process.exit();
    } else if (index == 3) {
        if (!val) {
            console.log("Invalid arguments")
            process.exit();
        } else {
            // This is what done by NodeSdk when it looks for NodeSdk
            ccPath = process.env["GOPATH"]+"/src/"+val;
        }
    }
});

// Read and process the credentials.json
var network;
try {
    network = JSON.parse(fs.readFileSync(__dirname+'/ServiceCredentials.json', 'utf8'));
} catch (err) {
    console.log("ServiceCredentials.json is missing, Rerun once the file is available")
    process.exit();
}

var peers = network.peers;
var users = network.users;

// Determining if we are running on a startup or HSBN network based on the url
// of the discovery host name.  The HSBN will contain the string zone.
var isHSBN = peers[0].discovery_host.indexOf('zone') >= 0 ? true : false;
var peerAddress = [];
var network_id = Object.keys(network.ca);
var ca_url = "grpc://" + network.ca[network_id].discovery_host + ":" + network.ca[network_id].discovery_port;

// Configure the KeyValStore which is used to store sensitive keys.
// This data needs to be located or accessible any time the users enrollmentID
// perform any functions on the blockchain.  The users are not usable without
// This data.
var uuid = network_id[0].substring(0,8);
chain.setKeyValStore(hfc.newFileKeyValStore(__dirname+'/keyValStore-'+uuid));
chain.setKeyValStore(hfc.newFileKeyValStore('/tmp/keyValStore'));

var certFile = 'certificate.pem';
var certUrl = network.cert;
fs.access(certFile, function (err) {
    if (!err) {
        //console.log("\nDeleting existing certificate ", certFile);
        //fs.unlinkSync(certFile);
    }
    //downloadCertificate();
    copyCertificate();
});

function downloadCertificate() {
    var file = fs.createWriteStream(certFile);
    var data = '';
    https.get(certUrl, function (res) {
        console.log('\nDownloading %s from %s', certFile, certUrl);
        if (res.statusCode !== 200) {
            console.log('\nDownload certificate failed, error code = %d', certFile, res.statusCode);
            process.exit();
        }
        res.on('data', function(d) {
                data += d;
        });
        // event received when certificate download is completed
        res.on('end', function() {
	    if (process.platform != "win32") {
		data += '\n';
	    }
            fs.writeFileSync(certFile, data);
	    copyCertificate();
            /*if (process.platform == "win32") {
                copyCertificate();
            } else {
                // Adding a new line character to the certificates
                fs.appendFile(certFile, "\n", function (err) {
                    if (err) throw err;
                    copyCertificate();
                });
            }*/
        });
    }).on('error', function (e) {
        console.error(e);
        process.exit();
    });
}

function copyCertificate() {
    //fs.createReadStream('certificate.pem').pipe(fs.createWriteStream(ccPath+'/certificate.pem'));
    fs.writeFileSync(ccPath + '/certificate.pem', fs.readFileSync(__dirname+'/certificate.pem'));

    setTimeout(function() {
        enrollAndRegisterUsers();
    }, 1000);
}

function enrollAndRegisterUsers() {
    var cert = fs.readFileSync(certFile);
    /*
    chain.setMemberServicesUrl(ca_url, {
        pem: cert
    });
    */
    chain.setMemberServicesUrl(ca_url);

    // Adding all the peers to blockchain
    // this adds high availability for the client
    for (var i = 0; i < peers.length; i++) {
        /*
        chain.addPeer("grpc://" + peers[i].discovery_host + ":" + peers[i].discovery_port, {
            pem: cert
        });
        */
        chain.addPeer("grpc://" + peers[i].discovery_host + ":" + peers[i].discovery_port);
    }

    console.log("\n\n------------- peers and caserver information: -------------");
    console.log(chain.getPeers());
    console.log(chain.getMemberServices());
    console.log('-----------------------------------------------------------\n\n');
    var testChaincodeID;

    // Enroll a 'admin' who is already registered because it is
    // listed in fabric/membersrvc/membersrvc.yaml with it's one time password.
    chain.enroll(users[0].enrollId, users[0].enrollSecret, function(err, admin) {
        if (err) throw Error("\nERROR: failed to enroll admin : " + err);

        console.log("\nEnrolled admin sucecssfully");

        // Set this user as the chain's registrar which is authorized to register other users.
        chain.setRegistrar(admin);

        var enrollName = "JohnDoe"; //creating a new user
        var registrationRequest = {
            enrollmentID: enrollName,
            account: "bank_a",
            affiliation: "00001"
        };
        chain.registerAndEnroll(registrationRequest, function(err, user) {
            if (err) throw Error(" Failed to register and enroll " + enrollName + ": " + err);

            console.log("\nEnrolled and registered " + enrollName + " successfully");

            //setting timers for fabric waits
            chain.setDeployWaitTime(60);
            chain.setInvokeWaitTime(20);
            console.log("\nDeploying chaincode ...");
            deployChaincode(user);
        });
    });
}

function deployChaincode(user) {
    // Construct the deploy request
    var deployRequest = {
        // Function to trigger
        fcn: "init",
        // Arguments to the initializing function
        args: ["a", "100", "b", "200"],
        // the location where the startup and HSBN store the certificates
        certificatePath: isHSBN ? "/root/" : "/certs/peer/cert.pem"
    };
    deployRequest.chaincodePath = "chaincode_example02";

    // Trigger the deploy transaction
    var deployTx = user.deploy(deployRequest);

    // Print the deploy results
    deployTx.on('complete', function(results) {
        // Deploy request completed successfully
        testChaincodeID = results.chaincodeID;
        console.log("\nChaincode ID : " + testChaincodeID);
        console.log(util.format("\nSuccessfully deployed chaincode: request=%j, response=%j", deployRequest, results));
        invokeOnUser(user);
    });

    deployTx.on('error', function(err) {
        // Deploy request failed
        console.log(util.format("\nFailed to deploy chaincode: request=%j, error=%j", deployRequest, err));
    });
}

function invokeOnUser(user) {
    // Construct the invoke request
    var invokeRequest = {
        // Name (hash) required for invoke
        chaincodeID: testChaincodeID,
        // Function to trigger
        fcn: "invoke",
        // Parameters for the invoke function
        args: ["a", "b", "1"]
    };

    // Trigger the invoke transaction
    var invokeTx = user.invoke(invokeRequest);

    // Print the invoke results
    invokeTx.on('submitted', function(results) {
        // Invoke transaction submitted successfully
        console.log(util.format("\nSuccessfully submitted chaincode invoke transaction: request=%j, response=%j", invokeRequest, results));
    });
    invokeTx.on('complete', function(results) {
        // Invoke transaction completed successfully
        console.log(util.format("\nSuccessfully completed chaincode invoke transaction: request=%j, response=%j", invokeRequest, results));
        queryUser(user);
    });
    invokeTx.on('error', function(err) {
        // Invoke transaction submission failed
        console.log(util.format("\nFailed to submit chaincode invoke transaction: request=%j, error=%j", invokeRequest, err));
    });
}

function queryUser(user) {
    // Construct the query request
    var queryRequest = {
        // Name (hash) required for query
        chaincodeID: testChaincodeID,
        // Function to trigger
        fcn: "query",
        // Existing state variable to retrieve
        args: ["a"]
    };

    // Trigger the query transaction
    var queryTx = user.query(queryRequest);

    // Print the query results
    queryTx.on('complete', function(results) {
        // Query completed successfully
        console.log("\nSuccessfully queried  chaincode function: request=%j, value=%s", queryRequest, results.result.toString());
    });
    queryTx.on('error', function(err) {
        // Query failed
        console.log("\nFailed to query chaincode, function: request=%j, error=%j", queryRequest, err);
    });
}
