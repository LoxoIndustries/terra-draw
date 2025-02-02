module.exports = (packageName, packageJsonPath, changelogPath) => ({
	bumpFiles: [
		{
			filename: packageJsonPath,
			type: "json",
		},
	],
	packageFiles: [packageJsonPath],
	writerOpts: {
		transform: (commit, context) => {
			// Only include commits scoped to the package
			if (!commit.scope || commit.scope !== packageName) {
				return null;
			}
			return commit;
		},
	},
	// verbose: true,
	changelogFile: changelogPath,
	releaseCommitMessageFormat: `chore(${packageName}): release version {{currentTag}}`,
});
