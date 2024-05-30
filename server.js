const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

//secrets!
const GITHUB_REPO_SEARCH_URL = 'https://api.github.com/search/repositories';
const GITHUB_USER_SEARCH_URL = 'https://api.github.com/search/users';
const GITHUB_TOKEN = process.env.NODE_APP_GITHUB_TOKEN;

// helper function to ensure what is in quotation marks shows up in results
function parseQuery(query) {
  const regex = /"([^"]+)"|(\S+)/g;
  const result = [];
  let match;
  while ((match = regex.exec(query)) !== null) {
    if (match[1]) {
      result.push(`"${match[1]}"`);
    } else if (match[2]) {
      result.push(match[2]);
    }
  }
  return result.join(' ');
}

app.get('/api/search/repositories', async (req, res) => {
  const { q, page = 1, per_page = 10 } = req.query;
  const parsedQuery = parseQuery(q);
  try {
    const response = await axios.get(GITHUB_REPO_SEARCH_URL, {
      params: { q: parsedQuery, page, per_page },
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `token ${GITHUB_TOKEN}`
      }
    });
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching repositories:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/search/users', async (req, res) => {
  const { q, page = 1, per_page = 10 } = req.query;

  try {
    console.log(`Searching users with query: ${q}, page: ${page}, per_page: ${per_page}`);
    const response = await axios.get(GITHUB_USER_SEARCH_URL, {
      params: { q, page, per_page },
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`
      }
    });

    let users = response.data.items;
    console.log(`Fetched ${users.length} users`);

    // Fetch lots of user details
    const userDetailsPromises = users.map(async (user) => {
      try {
        const userDetailsResponse = await axios.get(user.url, {
          headers: {
            'Authorization': `token ${GITHUB_TOKEN}`
          }
        });

        const reposResponse = await axios.get(`https://api.github.com/users/${user.login}/repos`, {
          headers: {
            'Authorization': `token ${GITHUB_TOKEN}`
          }
        });

        const public_repos = userDetailsResponse.data.public_repos;
        const total_forks = reposResponse.data.reduce((acc, repo) => acc + repo.forks_count, 0);
        const total_stars = reposResponse.data.reduce((acc, repo) => acc + repo.stargazers_count, 0);
        const total_size = reposResponse.data.reduce((acc, repo) => acc + repo.size, 0);
        const average_size = reposResponse.data.length > 0 ? total_size / reposResponse.data.length : 0;

        const languagesPromises = reposResponse.data.map(repo => axios.get(repo.languages_url, {
          headers: {
            'Authorization': `token ${GITHUB_TOKEN}`
          }
        }));
        const languagesResponses = await Promise.all(languagesPromises);

        const languageCounts = {};
        languagesResponses.forEach(response => {
          const languages = response.data;
          for (const [language, count] of Object.entries(languages)) {
            if (languageCounts[language]) {
              languageCounts[language] += 1;
            } else {
              languageCounts[language] = 1;
            }
          }
        });

        const sortedLanguages = Object.entries(languageCounts).sort((a, b) => b[1] - a[1]);
        const topLanguages = sortedLanguages.slice(0, 3);

        return {
          id: user.id,
          login: user.login,
          avatar_url: user.avatar_url,
          html_url: user.html_url,
          public_repos: public_repos,
          total_forks: total_forks,
          total_stars: total_stars,
          average_size: average_size,
          top_languages: topLanguages
        };
      } catch (error) {
        console.error(`Error fetching details for user ${user.login}:`, error);
        return {
          id: user.id,
          login: user.login,
          avatar_url: user.avatar_url,
          html_url: user.html_url,
          public_repos: 0,
          total_forks: 0,
          total_stars: 0,
          average_size: 0,
          top_languages: []
        };
      }
    });

    users = await Promise.all(userDetailsPromises);

    res.json({ items: users });
  } catch (error) {
    console.error('Failed to fetch data from GitHub', error);
    res.status(500).json({ error: 'Failed to fetch data from GitHub' });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
