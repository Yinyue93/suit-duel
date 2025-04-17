// -------------------------------------------------------------------
// Suit Duel Server-Side JavaScript (Node.js + ws + Express)
// Version with REQUEST_DRAW handler AND final health in GAME_OVER
// -------------------------------------------------------------------

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

// --- Server Setup ---
const app = express();
// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// --- Game Constants ---
const SUITS = ["♥", "♦", "♠", "♣"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const MAX_HEALTH = 20;
const STARTING_HEALTH = 20;
const STARTING_HAND_SIZE = 5;
const MAX_HAND_SIZE = 10;

// --- Server State ---
let players = {}; // Store player data: { id: { ws, name, gameId, id } }
let games = {};   // Store active games: { gameId: { ...game state... } }
let waitingPlayerId = null; // Simple matchmaking: ID of the player waiting
let nextPlayerId = 0;
let nextGameId = 0;

console.log("Server starting...");

// --- WebSocket Connection Handling ---
wss.on('connection', (ws) => {
    const playerId = nextPlayerId++;
    players[playerId] = { ws: ws, name: null, gameId: null, id: playerId };
    console.log(`Client connected, assigned ID: ${playerId}`);

    sendMessage(ws, 'CONNECTED', { playerId: playerId });

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log(`Message received from Player ${playerId} (${players[playerId]?.name || 'Unknown'}):`, data);
            handleClientMessage(playerId, data);
        } catch (error) {
            console.error(`Failed to parse message or handle client message from ${playerId}:`, error);
            sendMessage(ws, 'ERROR', { message: 'Invalid message format.' });
        }
    });

    ws.on('close', () => {
        console.log(`Client ${playerId} (${players[playerId]?.name || 'Unknown'}) disconnected.`);
        handlePlayerDisconnect(playerId);
    });

    ws.on('error', (error) => {
        console.error(`WebSocket error for client ${playerId}:`, error);
        handlePlayerDisconnect(playerId);
    });
});

// --- Message Handling Logic ---
function handleClientMessage(playerId, data) {
    const player = players[playerId];
    if (!player) {
        console.warn(`Received message from unknown or disconnected player ID: ${playerId}`);
        return;
    }

    const gameId = player.gameId;
    const game = gameId !== null ? games[gameId] : null;
    const playerState = game ? game.playerStates[playerId] : null;


    switch (data.type) {
        case 'JOIN':
            if (!data.name) {
                sendMessage(player.ws, 'ERROR', { message: 'Name is required to join.' });
                return;
            }
            if (player.gameId !== null) {
                 console.warn(`Player ${playerId} tried to JOIN while already in game ${player.gameId}`);
                 // Maybe just update name? For now, ignore if in game.
                 // sendMessage(player.ws, 'ERROR', { message: 'You are already in a game.' });
                 // return;
            }

            player.name = data.name.substring(0, 15);
            console.log(`Player ${playerId} set name to: ${player.name}`);

            // Matchmaking
            if (waitingPlayerId === null) {
                 if (player.gameId === null) {
                     waitingPlayerId = playerId;
                     sendMessage(player.ws, 'WAITING', { message: 'Waiting for an opponent...' });
                     console.log(`Player ${playerId} (${player.name}) is waiting.`);
                 }
            } else if (waitingPlayerId !== playerId) {
                const opponent = players[waitingPlayerId];
                if (opponent && opponent.gameId === null) {
                    console.log(`Pairing ${playerId} (${player.name}) with ${opponent.id} (${opponent.name})`);
                    const newGameId = nextGameId++;
                    player.gameId = newGameId;
                    opponent.gameId = newGameId;
                    waitingPlayerId = null;

                    games[newGameId] = createNewGame(player, opponent, newGameId);
                    sendInitialGameState(games[newGameId]);
                } else {
                    console.log(`Waiting player ${waitingPlayerId} not found or unavailable, player ${playerId} now waiting.`);
                     if (player.gameId === null) {
                         waitingPlayerId = playerId;
                         sendMessage(player.ws, 'WAITING', { message: 'Previous opponent unavailable, waiting for a new one...' });
                     }
                }
            } else {
                 sendMessage(player.ws, 'WAITING', { message: 'You are already waiting for an opponent...' });
            }
            break;

        case 'PLAY_CARD':
            if (!game) { sendMessage(player.ws, 'ERROR', { message: 'Not currently in a game.', unlockAction: true }); return; }
            if (!playerState) { sendMessage(player.ws, 'ERROR', { message: 'Internal server error: Player state missing.', unlockAction: true }); return; }
            handlePlayCard(player, game, playerState, data.card);
            break;

        case 'DISCARD_CARDS':
             if (!game) { sendMessage(player.ws, 'ERROR', { message: 'Not currently in a game.', unlockAction: true }); return; }
             if (!playerState) { sendMessage(player.ws, 'ERROR', { message: 'Internal server error: Player state missing.', unlockAction: true }); return; }
             handleDiscardCards(player, game, playerState, data.indices);
             break;

        case 'REQUEST_DRAW':
            if (!game) { sendMessage(player.ws, 'ERROR', { message: 'Not currently in a game.', unlockAction: true }); return; }
             if (!playerState) { sendMessage(player.ws, 'ERROR', { message: 'Internal server error: Player state missing.', unlockAction: true }); return; }
             handleRequestDraw(player, game, playerState, data); // Call dedicated handler
            break;

        case 'LEAVE_GAME':
             console.log(`Player ${playerId} requested to leave game ${gameId}`);
             if (game) {
                 const opponent = getOpponent(game, playerId);
                 if (opponent && players[opponent.playerId] && players[opponent.playerId].ws.readyState === WebSocket.OPEN) {
                    sendMessage(players[opponent.playerId].ws, 'PLAYER_DISCONNECTED', { message: `${player.name} left the game.` });
                     players[opponent.playerId].gameId = null;
                 }
                 delete games[gameId];
                 console.log(`Game ${gameId} removed.`);
             }
             player.gameId = null;
             sendMessage(player.ws, 'LEFT_GAME', { message: 'You left the game.' });
             break;

        default:
            console.log(`Unknown message type from ${playerId}: ${data.type}`);
            sendMessage(player.ws, 'ERROR', { message: `Unknown message type: ${data.type}` });
            break;
    }
}

// --- Player Disconnect Logic ---
function handlePlayerDisconnect(playerId) {
    const player = players[playerId];
    if (!player) return;

    console.log(`Handling disconnect for player ${playerId} (${player.name || 'Name not set'})`);

    if (playerId === waitingPlayerId) {
        console.log(`Waiting player ${playerId} disconnected.`);
        waitingPlayerId = null;
    } else if (player.gameId !== null && games[player.gameId]) {
        const game = games[player.gameId];
        console.log(`Player ${playerId} disconnected from game ${player.gameId}.`);
        const opponent = getOpponent(game, playerId);

        if (opponent && players[opponent.playerId] && players[opponent.playerId].ws.readyState === WebSocket.OPEN) {
            sendMessage(players[opponent.playerId].ws, 'PLAYER_DISCONNECTED', {
                message: `${player.name || 'Opponent'} disconnected. Game ended.`
            });
             players[opponent.playerId].gameId = null;
        } else {
             console.log(`Opponent ${opponent?.playerId} not found or already disconnected for game ${player.gameId}.`);
        }

        delete games[player.gameId];
        console.log(`Game ${player.gameId} removed due to player disconnect.`);
    }

    delete players[playerId];
    console.log(`Player ${playerId} removed from server state. Total players: ${Object.keys(players).length}`);
}


// --- Game Logic Functions ---

function getCardValue(rank) {
    if (["K", "Q", "J", "10"].includes(rank)) return 10;
    if (rank === "A") return 1;
    return parseInt(rank);
}

function createDeck() {
    const newDeck = [];
    for (const suit of SUITS) {
        for (const rank of RANKS) {
            newDeck.push({ suit, rank, value: getCardValue(rank) });
        }
    }
    return newDeck;
}

function shuffleDeck(deckToShuffle) {
    for (let i = deckToShuffle.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deckToShuffle[i], deckToShuffle[j]] = [deckToShuffle[j], deckToShuffle[i]];
    }
    return deckToShuffle;
}

function drawFromServerDeck(game, playerState, count = 1) {
    let drawnCards = [];
    if (!game || !playerState) {
        console.error("drawFromServerDeck called with invalid game or playerState");
        return drawnCards;
    }
    for (let i = 0; i < count; i++) {
        if (game.deck.length === 0) {
            if (game.discardPile.length === 0) {
                console.log(`Game ${game.gameId}: Deck and discard empty.`);
                break;
            }
            console.log(`Game ${game.gameId}: Reshuffling ${game.discardPile.length} cards from discard into deck.`);
            game.deck = shuffleDeck([...game.discardPile]);
            game.discardPile = [];
            if (game.deck.length === 0) {
                 console.log(`Game ${game.gameId}: Deck still empty after reshuffle.`);
                 break;
            }
        }

        const card = game.deck.pop();
        if (card && playerState.hand.length < MAX_HAND_SIZE) {
            playerState.hand.push(card);
            drawnCards.push(card);
        } else if (card) {
            game.deck.push(card);
            console.log(`Game ${game.gameId}: Player ${playerState.playerId} hand full (${playerState.hand.length}), card ${card.rank}${card.suit} not drawn.`);
            break;
        } else {
             console.error(`Game ${game.gameId}: Popped an invalid card from deck.`);
        }
    }
    return drawnCards;
}

function createNewGame(player1, player2, gameId) {
    console.log(`Creating new game ${gameId} for ${player1.name} (ID: ${player1.id}) and ${player2.name} (ID: ${player2.id})`);
    const deck = shuffleDeck(createDeck());
    const player1Hand = [];
    const player2Hand = [];

    for(let i = 0; i < STARTING_HAND_SIZE; i++) {
        if (deck.length > 0) player1Hand.push(deck.pop());
        if (deck.length > 0) player2Hand.push(deck.pop());
    }

    const startingPlayerId = Math.random() < 0.5 ? player1.id : player2.id;

    const game = {
        gameId: gameId,
        playerIds: [player1.id, player2.id],
        playerNames: { [player1.id]: player1.name, [player2.id]: player2.name },
        deck: deck,
        discardPile: [],
        playerStates: {
            [player1.id]: {
                playerId: player1.id,
                health: STARTING_HEALTH,
                hand: player1Hand,
                 mustDiscard: 0,
                 discardReason: "",
            },
            [player2.id]: {
                playerId: player2.id,
                health: STARTING_HEALTH,
                hand: player2Hand,
                 mustDiscard: 0,
                 discardReason: "",
            }
        },
        currentPlayerId: startingPlayerId,
        gameOver: false,
        winnerId: null,
        turnMessage: "",
    };
    console.log(`Game ${gameId} created. Starting player: ${startingPlayerId}. Deck size: ${game.deck.length}`);
    return game;
}

function sendInitialGameState(game) {
     if (!game) return;
    console.log(`Sending initial state for game ${game.gameId}`);
    game.playerIds.forEach(playerId => {
        const player = players[playerId];
        if (player && player.ws.readyState === WebSocket.OPEN) {
            const opponent = getOpponent(game, playerId);
             if (!opponent) { console.error(`Cannot send initial state to ${playerId}, opponent not found.`); return; }
            const opponentState = game.playerStates[opponent.playerId];
            const playerState = game.playerStates[playerId];
             if (!opponentState || !playerState) { console.error(`Cannot send initial state to ${playerId}, player states incomplete.`); return; }

            sendMessage(player.ws, 'GAME_START', {
                message: `Game started vs ${opponent.name}! ${game.currentPlayerId === playerId ? 'Your turn.' : `Waiting for ${opponent.name}.`}`,
                playerId: playerId,
                opponentName: opponent.name,
                hand: playerState.hand,
                playerHealth: playerState.health,
                opponentHealth: opponentState.health,
                opponentCardCount: opponentState.hand.length,
                discardPile: game.discardPile,
                deckCount: game.deck.length,
                isYourTurn: game.currentPlayerId === playerId,
            });
        } else {
             console.warn(`Cannot send initial state to player ${playerId}, connection not open or player not found.`);
        }
    });
}

// Sends updated game state to both players after an action
function broadcastGameState(game, messageOverride = null) {
     if (!game) { console.error("broadcastGameState called with null game."); return; }

    // --- !! GAME OVER HANDLING MODIFIED !! ---
    if (game.gameOver) {
         console.log(`Broadcasting Game Over for game ${game.gameId}`);
         let gameOverMessage = "";
         if(game.winnerId === 'draw') {
            gameOverMessage = "Game Over! It's a draw!";
         } else if (game.winnerId !== null) {
             const winnerName = game.playerNames[game.winnerId] || `Player ${game.winnerId}`;
             gameOverMessage = `Game Over! ${winnerName} wins!`;
         } else {
            gameOverMessage = "Game Over!"; // Fallback
         }

         // Send final GAME_OVER message with final health states
         game.playerIds.forEach(pid => {
             const player = players[pid];
             if(player && player.ws.readyState === WebSocket.OPEN) {
                 const opponent = getOpponent(game, pid);
                 const playerState = game.playerStates[pid];
                 const opponentState = game.playerStates[opponent?.playerId]; // Opponent might be missing if disconnected just before end

                 // Clamp health values to 0 for final display
                 const finalPlayerHealth = Math.max(0, playerState?.health || 0);
                 const finalOpponentHealth = Math.max(0, opponentState?.health || 0);

                sendMessage(player.ws, 'GAME_OVER', {
                    message: gameOverMessage,
                    playerHealth: finalPlayerHealth,
                    opponentHealth: finalOpponentHealth
                });
                player.gameId = null; // Reset player's game ID
             }
         });
         delete games[game.gameId];
         console.log(`Game ${game.gameId} removed after game over broadcast.`);
         return; // Stop broadcasting regular updates
    }
    // --- !! END OF GAME OVER MODIFICATION !! ---


    console.log(`Broadcasting state for game ${game.gameId}. Current turn: ${game.currentPlayerId}`);
    game.playerIds.forEach(playerId => {
        const player = players[playerId];
        if (player && player.ws.readyState === WebSocket.OPEN) {
            const opponent = getOpponent(game, playerId);
            if (!opponent) { console.error(`Opponent not found for player ${playerId} in game ${game.gameId} during broadcast.`); return; }
             const playerState = game.playerStates[playerId];
             const opponentState = game.playerStates[opponent.playerId];
             if (!playerState || !opponentState) { console.error(`Player state missing for game ${game.gameId} during broadcast. P1: ${!!playerState}, P2: ${!!opponentState}`); return; }


            let currentTurnMessage = "";
             if (messageOverride) {
                 currentTurnMessage = messageOverride;
             } else if (playerState.mustDiscard > 0) {
                  currentTurnMessage = playerState.discardReason || `Waiting for You to discard ${playerState.mustDiscard}...`;
             } else if(opponentState.mustDiscard > 0) {
                  currentTurnMessage = opponentState.discardReason || `Waiting for ${opponent.name} to discard ${opponentState.mustDiscard}...`;
             } else {
                 currentTurnMessage = game.currentPlayerId === playerId ? "Your turn. Play a card." : `Waiting for ${opponent.name}...`;
             }

            sendMessage(player.ws, 'GAME_UPDATE', {
                message: currentTurnMessage,
                playerHealth: playerState.health, // Send current health
                opponentHealth: opponentState.health, // Send current health
                hand: playerState.hand,
                opponentCardCount: opponentState.hand.length,
                discardPile: game.discardPile,
                deckCount: game.deck.length,
                isYourTurn: game.currentPlayerId === playerId && playerState.mustDiscard === 0,
            });

             if (playerId === game.currentPlayerId && playerState.mustDiscard > 0) {
                  sendMessage(player.ws, 'DISCARD_REQUIRED', {
                      count: playerState.mustDiscard,
                      reason: playerState.discardReason || "You must discard cards."
                  });
             }
        } else {
             console.warn(`Cannot broadcast to player ${playerId}, connection not open or player not found.`);
        }
    });
}

// --- Action Handling Functions ---

function handlePlayCard(player, game, playerState, cardData) {
    const playerId = player.id;
    const opponent = getOpponent(game, playerId);
    if (!opponent) { sendMessage(player.ws, 'ERROR', { message: 'Opponent not found.', unlockAction: true }); return; }
    const opponentState = game.playerStates[opponent.playerId];
     if (!opponentState) { sendMessage(player.ws, 'ERROR', { message: 'Opponent state missing.', unlockAction: true }); return; }

    // Validation
    if (game.gameOver) { sendMessage(player.ws, 'ERROR', { message: 'Game is over.', unlockAction: true }); return; }
    if (game.currentPlayerId !== playerId) { sendMessage(player.ws, 'ERROR', { message: 'Not your turn.', unlockAction: true }); return; }
    if (playerState.mustDiscard > 0) { sendMessage(player.ws, 'ERROR', { message: 'You must discard first.', unlockAction: true }); return; }

    const cardIndex = playerState.hand.findIndex(c => c.rank === cardData.rank && c.suit === cardData.suit);
    if (cardIndex === -1) { sendMessage(player.ws, 'ERROR', { message: 'Card not found in your hand.', unlockAction: true }); return; }

    const playedCard = playerState.hand.splice(cardIndex, 1)[0];
    game.discardPile.push(playedCard);
    console.log(`Game ${game.gameId}: Player ${playerId} (${player.name}) played ${playedCard.rank}${playedCard.suit}`);

    let effectMessage = `${player.name} played ${playedCard.rank}${playedCard.suit}.`;

    switch (playedCard.suit) {
        case '♥':
            const healAmount = playedCard.value;
            const healthBeforeHeal = playerState.health;
            playerState.health = Math.min(MAX_HEALTH, playerState.health + healAmount);
            effectMessage += ` Healed ${playerState.health - healthBeforeHeal} HP.`;
            break;
        case '♦':
            const drawAmount = playedCard.value;
            const drawnCards = drawFromServerDeck(game, playerState, drawAmount);
            effectMessage += ` Drew ${drawnCards.length} card(s).`;
            checkHandLimitServer(game, playerState); // Check limit immediately
            break;
        case '♠':
            const damageAmount = playedCard.value;
            opponentState.health -= damageAmount;
            effectMessage += ` Dealt ${damageAmount} damage to ${opponent.name}.`;
            break;
        case '♣':
            const discardAmount = playedCard.value;
             if (opponentState.hand.length > 0) {
                 const actualDiscard = Math.min(discardAmount, opponentState.hand.length);
                 opponentState.mustDiscard = actualDiscard;
                 opponentState.discardReason = `${player.name}'s ${playedCard.rank}${playedCard.suit} forces discard.`;
                 effectMessage += ` ${opponent.name} must discard ${actualDiscard} card(s).`;
                 game.currentPlayerId = opponent.playerId; // Opponent's turn to discard
             } else {
                 effectMessage += ` ${opponent.name} has no cards to discard.`;
                 game.currentPlayerId = opponent.playerId; // Still opponent's turn
             }
            break;
    }
     game.turnMessage = effectMessage;

    checkGameOverServer(game); // Check if this move ended the game

     // Determine next turn *if game not over*
     if (!game.gameOver) {
         if (playerState.mustDiscard > 0) {
             game.currentPlayerId = player.id; // Player needs to discard due to draw limit
         } else if (opponentState.mustDiscard > 0) {
             // Turn already set to opponent above if Clubs forced discard
         } else {
             // Normal turn switch if no discard needed by anyone (and not clubs)
              game.currentPlayerId = opponent.playerId;
         }
     }

    broadcastGameState(game, effectMessage); // Broadcast result (handles game over case internally)
}

function handleDiscardCards(player, game, playerState, indices) {
    const playerId = player.id;

    if (game.gameOver) { return; } // Ignore if game over
    if (playerState.mustDiscard <= 0) { sendMessage(player.ws, 'ERROR', { message: 'You are not required to discard now.', unlockAction: true }); return; }
    if (!Array.isArray(indices) || indices.length !== playerState.mustDiscard) { sendMessage(player.ws, 'ERROR', { message: `Invalid selection. You must discard exactly ${playerState.mustDiscard} cards (received ${indices?.length}).`, unlockAction: true }); return; }

    const uniqueIndices = [...new Set(indices)].sort((a, b) => b - a);
    if (uniqueIndices.length !== playerState.mustDiscard) { sendMessage(player.ws, 'ERROR', { message: `Invalid selection. Duplicate or incorrect number of card indices provided.`, unlockAction: true }); return; }
    let invalidIndexFound = false;
    for(const index of uniqueIndices) {
        if (index < 0 || index >= playerState.hand.length) {
             console.error(`Game ${game.gameId}: Player ${playerId} provided invalid discard index ${index} (Hand size: ${playerState.hand.length})`);
             invalidIndexFound = true; break;
        }
    }
     if (invalidIndexFound) { sendMessage(player.ws, 'ERROR', { message: `Invalid selection. Card index out of bounds.`, unlockAction: true }); return; }

    console.log(`Game ${game.gameId}: Player ${playerId} (${player.name}) is discarding indices:`, indices);

    let discardedCardsText = [];
    for (const index of uniqueIndices) {
        const discardedCard = playerState.hand.splice(index, 1)[0];
        game.discardPile.push(discardedCard);
        discardedCardsText.push(`${discardedCard.rank}${discardedCard.suit}`);
    }

    playerState.mustDiscard = 0;
    playerState.discardReason = "";
    const discardMessage = `${player.name} discarded ${discardedCardsText.length} card(s).`;
     game.turnMessage = discardMessage;

    checkGameOverServer(game);

    if (!game.gameOver) {
         const opponent = getOpponent(game, playerId);
          if (opponent) {
              game.currentPlayerId = opponent.playerId; // Switch turn to opponent
          } else {
               console.error(`Game ${game.gameId}: Cannot switch turn after discard, opponent not found for ${playerId}.`);
          }
    }

    broadcastGameState(game, discardMessage); // Broadcast result (handles game over case internally)
}

function handleRequestDraw(player, game, playerState, data) {
     const playerId = player.id;

     // Validation
     if (game.gameOver) { sendMessage(player.ws, 'ERROR', { message: 'Game is over.', unlockAction: true }); return; }
     if (game.currentPlayerId !== playerId || playerState.mustDiscard > 0) {
         console.warn(`Game ${game.gameId}: Player ${playerId} tried to draw out of turn (Current: ${game.currentPlayerId}) or while needing to discard (${playerState.mustDiscard}).`);
         sendMessage(player.ws, 'ERROR', { message: 'Not your turn to draw or discard required.', unlockAction: true });
         return;
     }

     const requestedCount = data.count;
     let actualCount = 0;
     let drawMessage = "";

     if (requestedCount === 5 && playerState.hand.length === 0) {
         actualCount = 5;
         drawMessage = `${player.name} starts turn with empty hand, drawing 5 cards.`;
     } else if (requestedCount === 1 && playerState.hand.length >= 0) {
         actualCount = 1;
         drawMessage = `${player.name} starts turn, drawing 1 card.`;
     } else {
          console.warn(`Game ${game.gameId}: Player ${playerId} requested invalid draw count ${requestedCount} with hand size ${playerState.hand.length}`);
          sendMessage(player.ws, 'ERROR', { message: `Invalid draw request. Hand size: ${playerState.hand.length}, Requested: ${requestedCount}`, unlockAction: true });
          return;
     }

     console.log(`Game ${game.gameId}: Player ${playerId} drawing ${actualCount} cards.`);
     const drawnCards = drawFromServerDeck(game, playerState, actualCount);
     drawMessage += ` Drew ${drawnCards.length}.`;

     checkHandLimitServer(game, playerState); // Check limit immediately
     game.turnMessage = drawMessage;
     checkGameOverServer(game);

     // Turn stays with player unless they now must discard
     if (!game.gameOver && playerState.mustDiscard > 0) {
         game.currentPlayerId = playerId;
     } else if (!game.gameOver) {
         game.currentPlayerId = playerId; // Still player's turn to play
     }

     broadcastGameState(game, drawMessage); // Broadcast state (handles game over internally)
}


// Checks and sets hand limit discard requirement for a player
function checkHandLimitServer(game, playerState) {
     if (!game || !playerState) return;

     if (playerState.hand.length > MAX_HAND_SIZE) {
         const excess = playerState.hand.length - MAX_HAND_SIZE;
         playerState.mustDiscard = excess;
         playerState.discardReason = "Hand limit exceeded.";
         console.log(`Game ${game.gameId}: Player ${playerState.playerId} must discard ${excess} due to hand limit.`);
         game.currentPlayerId = playerState.playerId; // Ensure it's their turn to discard
     }
}

// Checks if game is over and sets game state accordingly
function checkGameOverServer(game) {
     if (!game || game.gameOver) return game?.gameOver || false;

    const [p1Id, p2Id] = game.playerIds;
     if (!game.playerStates[p1Id] || !game.playerStates[p2Id]) { console.error(`Game ${game.gameId}: Cannot check game over, player states missing.`); return false; }
    const p1State = game.playerStates[p1Id];
    const p2State = game.playerStates[p2Id];

    // Check health AFTER potential effects resolve
    const p1Dead = p1State.health <= 0;
    const p2Dead = p2State.health <= 0;

    if (p1Dead && p2Dead) {
        game.gameOver = true;
        console.log(`Game ${game.gameId}: Sudden Death Check! P1 Cards: ${p1State.hand.length}, P2 Cards: ${p2State.hand.length}`);
        if (p1State.hand.length > p2State.hand.length) game.winnerId = p1Id;
        else if (p2State.hand.length > p1State.hand.length) game.winnerId = p2Id;
        else game.winnerId = 'draw';
        console.log(`Game ${game.gameId}: Sudden Death Result! Winner: ${game.winnerId}`);
    } else if (p1Dead) {
        game.gameOver = true;
        game.winnerId = p2Id;
        console.log(`Game ${game.gameId}: Player ${p2Id} (${game.playerNames[p2Id]}) wins! (Player ${p1Id} HP <= 0)`);
    } else if (p2Dead) {
        game.gameOver = true;
        game.winnerId = p1Id;
         console.log(`Game ${game.gameId}: Player ${p1Id} (${game.playerNames[p1Id]}) wins! (Player ${p2Id} HP <= 0)`);
    }
     // NOTE: Health is NOT clamped here, it's clamped before sending in GAME_OVER broadcast
    return game.gameOver;
}

// --- Utility Functions ---
function sendMessage(ws, type, payload = {}) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        try {
             ws.send(JSON.stringify({ type, ...payload }));
        } catch (e) {
             console.error("Failed to send message:", e);
        }
    } else {
        // console.warn(`Attempted to send message type ${type} to closed or invalid WebSocket.`);
    }
}

function getOpponent(game, playerId) {
     if (!game || !game.playerIds) return null;
    const opponentId = game.playerIds.find(id => id !== playerId);
     if (opponentId !== undefined && game.playerNames && game.playerNames[opponentId] !== undefined) {
         // Ensure the opponent still exists in the main players list
         if (players[opponentId]) {
              return { playerId: opponentId, name: game.playerNames[opponentId] };
         } else {
             console.warn(`Opponent ${opponentId} found in game ${game.gameId}, but not in global players list.`);
             return null;
         }
     }
    return null;
}


// --- Start Server ---
server.listen(PORT, () => {
    console.log(`--------------------------------`);
    console.log(` Server listening on port ${PORT} `);
    console.log(`--------------------------------`);
    console.log(`Access the game via the URL provided by Glitch (e.g., https://YOUR-PROJECT-NAME.glitch.me)`);
});