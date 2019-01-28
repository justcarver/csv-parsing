Input Data found in dealer_address-original.csv

Each test produces a matched file and an Unmatched file.  This file will be run as the input for the next test.

The name for "Al Packer Ford West (Royal Palm Beach" in the original screwed with RegEx searching in Mongo, so I modified this file to change that name to "Al Packer Ford West Royal Palm Beach".  This change is what is found as dealer_address.csv

First run produced matchedDealers-name,city,state,status2.csv.  This was produced with a query trying to match the name, city and state from the provided to all status 2 AUTO_DEALER tagged locations in our database.  There is an anomoly with bucket_location _id: WL5TaxR6Ns8j3juSc that causes the CSV to parse its address twice.  This was manuall fixed by me.
