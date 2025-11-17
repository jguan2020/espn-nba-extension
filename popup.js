const boxScoreCache = new Map();
const boxScorePollers = new Map();
const boxScoreRefreshRate = 20000; 

const resolveLogo = (team) => {
  if (!team) {
    return '';
  }

  if (Array.isArray(team.logos)) {
    const logoWithHref = team.logos.find((logo) => logo?.href);
    if (logoWithHref?.href) {
      return logoWithHref.href;
    }
  }

  return team.logo ?? '';
};




const fetchAndRenderBoxscore = async (eventId, summaryUrl, detailsEl) => {
  try {
    const response = await fetch(summaryUrl, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const summary = await response.json();
    const markup = buildBoxscoreHTML(summary);
    boxScoreCache.set(eventId, markup);
    renderBoxscoreContent(detailsEl, markup);
  } catch (error) {
    renderBoxscoreContent(detailsEl, '<div class="boxscore-empty">Box score unavailable.</div>');
    console.error('Box score fetch failed', error);
  }
};




const columns = [
  { key: 'minutes', label: 'MIN' },
  { key: 'fieldGoalsMade-fieldGoalsAttempted', label: 'FG' },
  { key: 'threePointFieldGoalsMade-threePointFieldGoalsAttempted', label: '3P' },
  { key: 'freeThrowsMade-freeThrowsAttempted', label: 'FT' },
  { key: 'points', label: 'PTS' },
  { key: 'assists', label: 'AST' },
  { key: 'rebounds', label: 'REB' },
  { key: 'steals', label: 'STL' },
  { key: 'blocks', label: 'BLK' },
  { key: 'turnovers', label: 'TO' },
  { key: 'fouls', label: 'PF' },
  { key: 'plusMinus', label: '+/-' },
];

const renderBoxscoreContent = (detailsEl, markup) => {
  detailsEl.innerHTML = markup;
};


const buildBoxscoreHTML = (summary) => {
  const sections = summary?.boxscore?.players;

  if (!Array.isArray(sections) || sections.length === 0) {
    return '<div class="boxscore-empty">Box score not available yet.</div>';
  }

  const renderHeaderCells = () => [
    '<th>Player</th>',
    ...columns.map(({ label }) => `<th>${label}</th>`),
  ].join('');

  const createKeyIndexMap = (keys = []) =>
    keys.reduce((acc, key, index) => {
      acc[key] = index;
      return acc;
    }, {});

  const renderDidNotPlayRow = (name, reason) => `
    <tr>
      <td class="boxscore-player">${name}</td>
      <td class="boxscore-dnp" colspan="${columns.length}">
        ${reason}
      </td>
    </tr>
  `;

  const renderStatCells = (statsArray = [], keyIndexMap) =>
    columns.map(({ key }) => {
      const statIndex = keyIndexMap[key];
      const hasValue = statIndex !== undefined && statIndex < statsArray.length;
      const value = hasValue ? statsArray[statIndex] || '-' : '-';
      return `<td>${value}</td>`;
    }).join('');

  const renderPlayerRow = (player, keyIndexMap) => {
    const name = player?.athlete?.displayName ?? 'Player';

    if (player?.didNotPlay?.reason) {
      return renderDidNotPlayRow(name, player.didNotPlay.reason);
    }

    return `
      <tr>
        <td class="boxscore-player">${name}</td>
        ${renderStatCells(player?.stats ?? [], keyIndexMap)}
      </tr>
    `;
  };

  const renderTeamSection = (section) => {
    const teamName = section?.team?.displayName ?? 'Team';
    const statsBlock = section?.statistics?.[0];
    const players = Array.isArray(statsBlock?.athletes) ? statsBlock.athletes : [];

    if (players.length === 0) {
      return `
        <section class="boxscore-team">
          <h4 class="boxscore-team-name">${teamName}</h4>
          <div class="boxscore-empty">No player stats yet.</div>
        </section>
      `;
    }

    const keyIndexMap = createKeyIndexMap(statsBlock?.keys);
    const playerRows = players.map((player) => renderPlayerRow(player, keyIndexMap)).join('');

    return `
      <section class="boxscore-team">
        <h4 class="boxscore-team-name">${teamName}</h4>
        <table class="boxscore-table">
          <thead><tr>${renderHeaderCells()}</tr></thead>
          <tbody>${playerRows}</tbody>
        </table>
      </section>
    `;
  };

  return sections.map(renderTeamSection).join('');
};





const toggleBoxscore = async (gameEl) => {
  if (!gameEl) {
    return;
  }

  const details = gameEl.querySelector('.boxscore');
  if (!details) {
    return;
  }

  const { eventId, summaryUrl } = gameEl.dataset ?? {};
  if (!eventId || !summaryUrl) {
    return;
  }

  const toggleBtn = gameEl.querySelector('.boxscore-toggle-btn');
  const isOpen = !details.hasAttribute('hidden');

  const updateToggleLabel = (text) => {
    if (toggleBtn) {
      toggleBtn.textContent = text;
    }
  };

  const stopPolling = () => {
    const poller = boxScorePollers.get(eventId);
    if (!poller) {
      return;
    }
    clearInterval(poller);
    boxScorePollers.delete(eventId);
  };

  const startPolling = () => {
    const poller = setInterval(() => {
      fetchAndRenderBoxscore(eventId, summaryUrl, details);
    }, boxScoreRefreshRate);

    boxScorePollers.set(eventId, poller);
  };

  const closeBoxscore = () => {
    details.setAttribute('hidden', '');
    gameEl.classList.remove('game-open');
    updateToggleLabel('Box Score');
    stopPolling();
  };

  const openBoxscore = async () => {
    gameEl.classList.add('game-open');
    details.removeAttribute('hidden');
    updateToggleLabel('Collapse');
    renderBoxscoreContent(details, '<div class="boxscore-loading">Loading box score…</div>');

    stopPolling();

    if (boxScoreCache.has(eventId)) {
      renderBoxscoreContent(details, boxScoreCache.get(eventId));
    }

    await fetchAndRenderBoxscore(eventId, summaryUrl, details);
    startPolling();
  };

  if (isOpen) {
    closeBoxscore();
    return;
  }

  await openBoxscore();
};






window.addEventListener('DOMContentLoaded', async () => {
  const container = document.getElementById('scores');
  if (!container) {
    return;
  }

  container.textContent = 'Loading…';

  try {
    const response = await fetch(
      'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard',
      { cache: 'no-store' }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    const events = Array.isArray(payload?.events) ? payload.events : [];

    if (events.length === 0) {
      container.textContent = 'No games today.';
      return;
    }

    const mapTeam = (competitor = {}) => ({
      name: competitor.team?.displayName ?? 'Team',
      short: competitor.team?.abbreviation ?? '--',
      score: Number(competitor.score ?? 0),
      logo: resolveLogo(competitor.team),
    });

    const games = events.map((event) => {
      const competition = event?.competitions?.[0];
      const competitors = Array.isArray(competition?.competitors)
        ? [...competition.competitors]
        : [];

      const [away, home] = competitors.sort((a, b) =>
        a.homeAway.localeCompare(b.homeAway)
      );

      return {
        id: event.id,
        summaryUrl: `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${event.id}`,
        gameLink: `https://www.espn.com/nba/game?gameId=${event.id}`,
        statusText: competition?.status?.type?.detail ?? '',
        statusState: competition?.status?.type?.state ?? '',
        home: mapTeam(home),
        away: mapTeam(away),
      };
    });

    const renderLogo = (logoUrl, teamName) => {
      if (!logoUrl) {
        return '';
      }

      return `<img class="team-logo" src="${logoUrl}" alt="${teamName} logo">`;
    };

    container.innerHTML = games
      .map(({ id, summaryUrl, gameLink, home, away, statusText, statusState }) => {
        const gameFinished = statusState === 'post';
        const awayWon = gameFinished && away.score > home.score;
        const homeWon = gameFinished && home.score > away.score;
        const isLive = statusState === 'in';

        const awayScoreClass = awayWon ? 'score score-win-left' : 'score';
        const homeScoreClass = homeWon ? 'score score-win-right' : 'score';
        const statusClass = isLive ? 'status status-live' : 'status';

        return `
          <div class="game" data-event-id="${id}" data-summary-url="${summaryUrl}" tabindex="0">
            <div class="game-summary">
              <span class="team team-away">
                <span class="team-tricode">${away.short}</span>
                <span class="team-name">${away.name}</span>
                ${renderLogo(away.logo, away.name)}
              </span>
              <span class="${awayScoreClass}">${away.score}</span>
              <span class="${homeScoreClass}">${home.score}</span>
              <span class="team team-home">
                <span class="team-tricode">${home.short}</span>
                <span class="team-name">${home.name}</span>
                ${renderLogo(home.logo, home.name)}
              </span>
              <span class="${statusClass}">${statusText}</span>
              <div class="game-actions">
                <button class="boxscore-toggle-btn" type="button">Box Score</button>
                <a class="game-link" href="${gameLink}" target="-blank" rel="noopener noreferrer">ESPN</a>
              </div>
            </div>
            <div class="boxscore" hidden></div>
          </div>
        `;
      })
      .join('');

    if (container.dataset.boxscoreBound !== 'true') {
      container.addEventListener('click', async (event) => {
        if (event.target.classList.contains('boxscore-toggle-btn')) {
          event.stopPropagation();
          const gameEl = event.target.closest('.game');
          if (gameEl) {
            await toggleBoxscore(gameEl);
          }
          return;
        }

        const gameEl = event.target.closest('.game');
        if (!gameEl || event.target.closest('.boxscore')) {
          return;
        }

        await toggleBoxscore(gameEl);
      });

      container.addEventListener('keydown', async (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
          return;
        }

        const gameEl = event.target.closest('.game');
        if (!gameEl) {
          return;
        }

        event.preventDefault();
        await toggleBoxscore(gameEl);
      });

      container.dataset.boxscoreBound = 'true';
    }
  } catch (error) {
    container.textContent = 'Failed to load scores.';
    console.error(error);
  }
});




