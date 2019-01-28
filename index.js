require('dotenv').config();

const fs = require('fs');
const csvParse = require('csv-parse');
const stringify = require('csv-stringify');
const inquirer = require('inquirer');

const { MongoClient } = require('mongodb');

// Connection URL
const url = process.env.DB_URL;

// Database Name
const dbName = process.env.DB_NAME;

// Has the client been closed?
// We will need to instaniate a new one
let hasBeenClosed = false;

// Create a new MongoClient
let client = new MongoClient(url, { useNewUrlParser: true });

// Store the DB since it will be reused across functions
let db = null;
let collection = null;

// Various Variables
let overallCount = 0;
let matched = 0;
let unmatched = 0;
let csvArray = [];
let matchedArray = [];
let unmatchedArray = [];
let newLocArray = [];
let questionableArray = [];
let canExit = false;
let initialFile = process.argv[2] || "dealer_address.csv";

const makeSureClientAndDbAreInitialized = async () => {
  if (hasBeenClosed) {
    console.log('Creating a new client because the previous one has been closed...');
    hasBeenClosed = false;
    client = new MongoClient(url, { useNewUrlParser: true });
  }
  if (!client.isConnected()) {
    console.log('Client is connecting...');
    await client.connect();
    db = client.db(dbName);
    collection = db.collection('bucket_locations');
  }
};

const closeClient = async () => {
  console.log("total: ", total);
  console.log("csvArray: ", csvArray.length);
  console.log("matchedArray: ", matchedArray.length);
  console.log("unmatchedArray: ", unmatchedArray.length);
  console.log("questionableArray: ", questionableArray.length);
  if (client.isConnected()) {
    console.log('Client is closing...');
    hasBeenClosed = true;
    await client.close();
  }
};

const readFile = async () => {
  await makeSureClientAndDbAreInitialized();
  fs.createReadStream(`./${initialFile}`)
    .pipe(csvParse())
    .on('data', data => {
      csvArray.push(data);
    })
    .on('end', () => {
      processArray();
    });
}

const processArray = async () => {
  await makeSureClientAndDbAreInitialized();
  total = csvArray.length;
  await csvArray.forEach( async (dealer) => {
    let streetNumber = dealer[7].match(/[0-9]+/i) || dealer[11].match(/[0-9]+/i);
    streetNumber = (streetNumber && streetNumber[0]) || '0';
    let streetRegEx = new RegExp(streetNumber, 'i');
    let zip = dealer[10] || dealer[14]
    let cursor = collection.find({"tags": "AUTO_DEALERS", "zip": zip, "status": 2});
    await processCursor(cursor, dealer);
  });
}

const processCursor = async (cursor, dealer) => {
  let documents = await cursor.toArray();
  overallCount++;
  if (documents.length >= 1) {
    questionableArray.push({
      dealer: dealer,
      possibleMatches: documents
    });
  } else {
    unmatched++;
    unmatchedArray.push([...dealer]);
  }
  console.log(`${overallCount}/${total}`);
  if (overallCount == total) {
    await closeClient();
    await writeUnMatchedArray();
    inquireMatches();
  }
}

const inquireMatches = async () => {
  if (questionableArray.length > 0) {
    let prompts = [];
    let questionNumber = 0;
    let questionTotal = questionableArray.length;
    await questionableArray.forEach( async (obj, qaIndex) => {
      let choices = [];
      let dealerText = `  ${obj.dealer[3]} | ${obj.dealer[7] || obj.dealer[11]}`;
      questionNumber ++;
      await obj.possibleMatches.forEach( (match, pmIndex) => {
        choices.push({
          name: `${match.name} | ${match.address}`,
          value: pmIndex,
          short: `${match.name} | ${match.address}`
        });
      });
      choices.push({
        name: "New Loc",
        value: "new-loc",
        short: "new-loc"
      });
      choices.push({
        name: "Select None",
        value: "select-none",
        short: "No location"
      });
      choices.push(new inquirer.Separator());
      prompts.push({
        type: 'list',
        name: `${qaIndex}`,
        message: `#${qaIndex+1}/${questionTotal} Best Match for:\n${dealerText}`,
        choices: choices
      });
    });
    canExit = true;
    inquirer.prompt(prompts).then(async (answers) => {
      await processAnswers(answers);
      processFinalArrays();
    })
  }
}

const processAnswers = async (answers)=> {
  Object.entries(answers).forEach( answer => {
    let questionableIndex = parseInt(answer[0]);
    let selectedMatchIndex = answer[1];

    if (selectedMatchIndex == 'select-none') {
      unmatched++;
      unmatchedArray.push([...questionableArray[questionableIndex].dealer]);
    } else if (selectedMatchIndex == 'new-loc') {
      newLocArray.push([...questionableArray[questionableIndex].dealer]);
    } else {
      matched++;
      matchedArray.push([
        questionableArray[questionableIndex].possibleMatches[selectedMatchIndex]._id,
        questionableArray[questionableIndex].possibleMatches[selectedMatchIndex].status,
        'FALSE',
        questionableArray[questionableIndex].possibleMatches[selectedMatchIndex].name,
        questionableArray[questionableIndex].dealer[3],
        questionableArray[questionableIndex].dealer[0],
        questionableArray[questionableIndex].dealer[1],
        questionableArray[questionableIndex].dealer[7],
        questionableArray[questionableIndex].dealer[8],
        questionableArray[questionableIndex].dealer[9],
        questionableArray[questionableIndex].dealer[10],
        questionableArray[questionableIndex].dealer[11],
        questionableArray[questionableIndex].dealer[12],
        questionableArray[questionableIndex].dealer[13],
        questionableArray[questionableIndex].dealer[14]
      ]);
    }
  });
  console.log(`Finished!\nMatched: ${matched} ${Math.floor((matched / total) * 100)}%\nUnmatched: ${unmatched}\nTotal: ${total}`)
}

const processFinalArrays = async () => {
  console.log("Attempting to write the files");
  let filterName = '';
  matchedArray.unshift(["et_buckloc_id","et_bucketloc_status",'?',"et_bucketloc_name","AA_dealer_name","AA_dealer_id","dealer_group_id","AA_address","AA_city","AA_state","AA_postal","AA_billing_address_street","AA_billing_address_city","AA_billing_address_state","AA_billing_address_postal_code"]);

  let outputQuestionableArray = [];
  outputQuestionableArray.push(csvArray[0]);
  await questionableArray.forEach(question => {
    outputQuestionableArray.push(question.dealer)
  });
  await stringify(matchedArray, (err, output) => {
    fs.writeFile(`matchedDealer${initialFile.charAt(initialFile.indexOf('.') - 1)}${filterName}.csv`, output, 'utf-8', (err) => {
      if (err) {
        console.log("Some error occured- Matched file either not saved or corrupted file saved");
      } else {
        console.log("Matched File saved");
      }
    });
  });
  await stringify(newLocArray, (err, output) => {
    fs.writeFile(`newLocationsNeeded${initialFile.charAt(initialFile.indexOf('.') - 1)}${filterName}.csv`, output, 'utf-8', (err) => {
      if (err) {
        console.log("Some error occured- Matched file either not saved or corrupted file saved");
      } else {
        console.log("New Location File saved");
      }
    });
  });
  
}

const writeUnMatchedArray = async () => {
  let filterName = '';
  await stringify(unmatchedArray, (err, output) => {
    fs.writeFile(`unmatchedDealer${initialFile.charAt(initialFile.indexOf('.') - 1)}${filterName}.csv`, output, 'utf-8', (err) => {
      if (err) {
        console.log("Some error occured- Unmatched file either not saved or corrupted file saved");
      } else {
        console.log("Unmatched File saved");
      }
    });
  });
}



process.on('SIGINT', async () => {
  console.log("\nCaught interrupt signal");
  closeClient();
  process.exit();
});

readFile();
