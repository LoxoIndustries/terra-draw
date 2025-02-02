import * as bump from "../../bump.mjs";
import * as path from 'path';
import { Bumper } from 'conventional-recommended-bump';
import { readFileSync } from "fs";

const gitPath = path.resolve('../../');
const bumper = new Bumper(gitPath);

const packageName = JSON.parse(readFileSync('package.json', 'utf8')).name;
bump.getBumpType(bumper, packageName);