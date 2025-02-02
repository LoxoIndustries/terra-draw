async function getBumpType(bumper, packageName) {
    await bumper.loadPreset('conventionalcommits')

    const recommendation = await bumper.bump(
        (commits) => {
            let recommendation = 0;
            for (let commit of commits.slice(0, -1)) {
                if (commit.scope === packageName) {
                    if (recommendation < 2 && commit.type === 'feat') {
                        recommendation = 1;
                    }

                    if (commit.notes.some((note) => note.title === 'BREAKING CHANGE')) {
                        recommendation = 2;
                    }
                }
            }

            return {
                level: recommendation,
                reason: 'Based on conventional commits',
                releaseType: ['patch', 'minor', 'major'][recommendation]
            }
        }

    )

    console.log(recommendation.releaseType)
    process.exit(0)
}

export { getBumpType }