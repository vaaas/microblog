#!/bin/sh

curl -X POST --data-binary @- 'http://localhost:50000/?password=password'
