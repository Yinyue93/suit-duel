// -------------------------------------------------------------------
// Suit Duel Client-Side JavaScript (Handles AI and Online Play)
// Version with AI Start-of-Turn Draw Fix AND Game Over Hand Clear Fix
// -------------------------------------------------------------------

// --- Constants ---
const SUITS = ["♥", "♦", "♠", "♣"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const MAX_HEALTH = 20;
const STARTING_HEALTH = 20;
const STARTING_HAND_SIZE = 5;
const MAX_HAND_SIZE = 10;

// --- State Variables ---
let gameMode = null; // 'ai' or 'online'
let ws = null; // WebSocket connection
let playerName = "You"; // Default, updated for online
let opponentName = "Opponent"; // Default, updated for AI/Online
let playerId = null; // Assigned by server for online play
let deckCountFromServer = 0; // For online mode deck count display

// Game State (Common)
let deck = []; // Used primarily by AI mode
let discardPile = [];
let playerHand = [];
let opponentHand = []; // For AI: holds actual cards. For Online: might just store count.
let opponentCardCount = 0; // Used primarily for online display
let playerHealth = STARTING_HEALTH;
let opponentHealth = STARTING_HEALTH;
let isPlayerTurn = true;
let gameOver = false;
let gameMessage = "";
let actionInProgress = false; // Prevents overlapping actions

// Discarding State (Player)
let isDiscarding = false;
let requiredDiscardCount = 0;
let selectedDiscardIndices = [];
let discardCompletionCallback = null; // Used for AI mode promise

// --- DOM Elements ---
// Mode Selection & Online Setup
const modeSelectionDiv = document.getElementById('mode-selection');
const onlineSetupDiv = document.getElementById('online-setup');
const playAiButton = document.getElementById('play-ai-button');
const playOnlineButton = document.getElementById('play-online-button');
const playerNameInput = document.getElementById('player-name-input');
const joinGameButton = document.getElementById('join-game-button');
const connectionStatusP = document.getElementById('connection-status');

// Game Board
const gameContainerDiv = document.getElementById('game-container');
const messageAreaEl = document.getElementById('message-area');
// Opponent Area
const opponentNameH2 = document.getElementById('opponent-name');
const opponentHealthEl = document.getElementById('opponent-health');
const opponentCardCountEl = document.getElementById('opponent-card-count');
const opponentHandEl = document.getElementById('opponent-hand');
// Game Info
const deckCountEl = document.getElementById('deck-count');
const discardCountEl = document.getElementById('discard-count');
const discardTopEl = document.getElementById('discard-top');
// Player Area
const playerNameH2 = document.getElementById('player-name-display');
const playerHealthEl = document.getElementById('player-health');
const playerCardCountEl = document.getElementById('player-card-count');
const playerHandEl = document.getElementById('player-hand');
const discardButton = document.getElementById('discard-button');
// Other Buttons
const restartButton = document.getElementById('restart-button'); // Primarily for AI
const leaveOnlineButton = document.getElementById('leave-online-button'); // For Online

// --- Utility Functions ---
function getCardValue(rank) {
    if (["K", "Q", "J", "10"].includes(rank)) return 10;
    if (rank === "A") return 1;
    return parseInt(rank);
}

function setGameMessage(newMessage, immediateUpdate = true) {
    gameMessage = newMessage;
    if (immediateUpdate) {
        messageAreaEl.textContent = gameMessage;
    }
}

// --- Core Game Logic Functions (Used mainly by AI mode, adapted where needed) ---
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
    // Fisher-Yates Shuffle
    for (let i = deckToShuffle.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deckToShuffle[i], deckToShuffle[j]] = [deckToShuffle[j], deckToShuffle[i]];
    }
    return deckToShuffle;
}

// Draws cards for AI mode from the local deck
function drawCardFromLocalDeck(targetHand, count = 1) {
    let drawnCards = [];
    for (let i = 0; i < count; i++) {
        if (deck.length === 0) {
            if (discardPile.length === 0) {
                console.warn("AI Mode: Deck and discard pile are empty!");
                setGameMessage("Deck and discard empty. Cannot draw.", true);
                break; // Stop drawing
            }
            // Reshuffle for AI mode
            setGameMessage("Deck empty. Shuffling discard pile...", true);
            deck = shuffleDeck([...discardPile]);
            discardPile = [];
            // Optional delay can be added here if desired
            if (deck.length === 0) break; // Still empty after shuffle? Stop.
        }

        const card = deck.pop();
        if (card && targetHand.length < MAX_HAND_SIZE) {
            targetHand.push(card);
            drawnCards.push(card);
        } else if (card) {
            // Drawn card exceeds limit, put it back
            deck.push(card);
            console.warn("AI Mode: Drew card exceeding hand limit during local draw.");
            setGameMessage("Hand limit reached, cannot draw more.", true); // Inform player/log
            break; // Stop drawing if hand limit reached
        }
    }
    return drawnCards; // Return the cards actually drawn
}

// Apply card effect locally (for AI Mode)
async function applyCardEffectAI(card, actorHand, targetHand, actorIsPlayer) {
    const actorName = actorIsPlayer ? playerName : opponentName;
    const targetName = actorIsPlayer ? opponentName : playerName;
    let message = `${actorName} plays ${card.rank}${card.suit}: `;
    actionInProgress = true; // Lock during effect processing

    switch (card.suit) {
        case '♥': // Heal actor
            const healAmount = card.value;
            let actualHeal = 0;
            if (actorIsPlayer) {
                const healthBefore = playerHealth;
                playerHealth = Math.min(MAX_HEALTH, playerHealth + healAmount);
                actualHeal = playerHealth - healthBefore;
            } else {
                const healthBefore = opponentHealth;
                opponentHealth = Math.min(MAX_HEALTH, opponentHealth + healAmount);
                actualHeal = opponentHealth - healthBefore;
            }
            message += `Healed ${actualHeal} HP.`;
            break;

        case '♦': // Actor draws cards
            const drawAmount = card.value;
            let maxDraw = MAX_HAND_SIZE - actorHand.length;
            let actualDrawCount = Math.min(drawAmount, maxDraw);
            message += `Attempting to draw ${drawAmount}. `;
            if (actualDrawCount < drawAmount) {
                 message += `Hand limit allows drawing ${actualDrawCount}. `;
            }
            const drawnCards = drawCardFromLocalDeck(actorHand, actualDrawCount); // Use local draw
            message += `Drew ${drawnCards.length} card(s).`;
            break;

        case '♠': // Damage target
            const damageAmount = card.value;
            if (actorIsPlayer) {
                opponentHealth -= damageAmount;
            } else {
                playerHealth -= damageAmount;
            }
            message += `Dealt ${damageAmount} damage to ${targetName}.`;
            break;

        case '♣': // Target discards
            const discardAmount = card.value;
            let targetCurrentHandSize = targetHand.length;
            const actualDiscardCount = Math.min(discardAmount, targetCurrentHandSize);
            message += `${targetName} must discard ${actualDiscardCount} card(s).`;

            if (actualDiscardCount > 0) {
                 setGameMessage(message, true); // Update message before potential delay/prompt
                 await new Promise(resolve => setTimeout(resolve, 500)); // Short pause

                 if (actorIsPlayer) { // AI (target) needs to discard
                     let indicesToDiscard = targetHand // targetHand is aiHand (opponentHand) here
                         .map((c, index) => ({ ...c, originalIndex: index }))
                         .sort((a, b) => a.value - b.value) // AI discards lowest value
                         .slice(0, actualDiscardCount)
                         .map(c => c.originalIndex)
                         .sort((a, b) => b - a); // Sort descending for splice

                     message = `AI discards ${actualDiscardCount} card(s).`;
                     for (const index of indicesToDiscard) {
                         // Check index validity before splicing (safety)
                         if (index >= 0 && index < targetHand.length) {
                            discardPile.push(targetHand.splice(index, 1)[0]);
                         } else {
                             console.error("AI Discard: Invalid index calculated:", index);
                         }
                     }
                 } else { // Player (target) needs to discard
                      const discardReason = `${opponentName}'s ${card.rank}${card.suit} forces discard.`;
                      // Use the visual discard mechanism, which returns a promise for AI mode
                      await initiatePlayerDiscard(actualDiscardCount, discardReason);
                      // Message updated within initiatePlayerDiscard/handleConfirmDiscardClick
                      message = gameMessage; // Get message updated by discard process
                 }
            } else {
                 message = `${targetName} has no cards to discard.`;
            }
            break;
    }

    setGameMessage(message, true);
    updateGameInfo(); // Update UI after effect application
    // Do not release actionInProgress here if a discard prompt was initiated
    if (!isDiscarding) {
         actionInProgress = false; // Release lock ONLY if not waiting for discard
    }
    await new Promise(resolve => setTimeout(resolve, 800)); // Pause to read message
}

// Check hand limit locally (for AI Mode)
async function checkHandLimitAI(hand, isPlayer) {
    if (hand.length > MAX_HAND_SIZE) {
        actionInProgress = true; // Lock during check/discard
        const excess = hand.length - MAX_HAND_SIZE;
        const ownerName = isPlayer ? playerName : opponentName;
        const reason = `${ownerName} have ${hand.length} cards (limit ${MAX_HAND_SIZE}). Must discard ${excess}.`;

        if (isPlayer) {
            // Player needs to discard visually
            await initiatePlayerDiscard(excess, reason);
            // initiatePlayerDiscard promise resolves after player confirms
            // actionInProgress is released inside handleConfirmDiscardClick for AI mode
        } else { // AI discards
            setGameMessage(reason, true);
            await new Promise(resolve => setTimeout(resolve, 1000)); // AI thinking time

            let indicesToDiscard = hand // aiHand (opponentHand) here
               .map((c, index) => ({ ...c, originalIndex: index }))
               .sort((a, b) => a.value - b.value) // AI discards lowest value
               .slice(0, excess)
               .map(c => c.originalIndex)
               .sort((a, b) => b - a); // Sort descending for splice

             let discardMsg = `AI discards ${excess} lowest value card(s).`;
             setGameMessage(discardMsg, true);
             await new Promise(resolve => setTimeout(resolve, 800)); // Pause to read

             for (const index of indicesToDiscard) {
                 // Check index validity before splicing (safety)
                  if (index >= 0 && index < hand.length) {
                    discardPile.push(hand.splice(index, 1)[0]);
                 } else {
                      console.error("AI Hand Limit Discard: Invalid index calculated:", index);
                 }
             }
             actionInProgress = false; // Release lock after AI discard completes
        }
        updateGameInfo(); // Update UI after discard
    }
     // Ensure lock is released if no discard was needed
     else if (actionInProgress && !isDiscarding) {
         actionInProgress = false;
     }
}

// Check game over locally (for AI Mode) - WITH HAND CLEAR FIX
function checkGameOverAI() {
    const playerHealthFinal = Math.max(0, playerHealth);
    const opponentHealthFinal = Math.max(0, opponentHealth);
    const playerDead = playerHealthFinal <= 0;
    const opponentDead = opponentHealthFinal <= 0;

    let isOver = false;
    let finalMessage = "";
    let playerWon = false; // Track winner for hand clearing
    let aiWon = false;     // Track winner for hand clearing

    if (playerDead && opponentDead) {
        isOver = true;
        finalMessage = "Sudden Death! Both players at 0 HP. ";
        if (playerHand.length > opponentHand.length) {
            finalMessage += `${playerName} wins with more cards!`;
            playerWon = true;
            aiWon = false;
        } else if (opponentHand.length > playerHand.length) {
            finalMessage += `${opponentName} wins with more cards!`;
            playerWon = false;
            aiWon = true;
        } else {
            finalMessage += "It's a draw (same card count)!";
            // Clear both hands visually on a draw
            playerWon = false;
            aiWon = false;
        }
    } else if (playerDead) {
        isOver = true;
        finalMessage = `${opponentName} wins! Your health reached 0.`;
        playerWon = false;
        aiWon = true;
    } else if (opponentDead) {
        isOver = true;
        finalMessage = `${playerName} wins! ${opponentName}'s health reached 0.`;
        playerWon = true;
        aiWon = false;
    }

    if (isOver) {
        gameOver = true;
        actionInProgress = false; // Ensure unlocked on game over
        isDiscarding = false; // Ensure discard mode is exited

        // --- FIX: Clear loser's hand array ---
        if (!playerWon) { // Player lost or drew
            console.log("AI Mode Game Over: Clearing player hand.");
            playerHand = []; // Clear player's logical hand state
        }
        if (!aiWon) { // AI lost or drew
            console.log("AI Mode Game Over: Clearing AI hand.");
            opponentHand = []; // Clear AI's logical hand state
        }
        // --- End Fix ---

        setGameMessage(finalMessage, true); // Set message *after* clearing hands
        restartButton.style.display = 'block';
        // updateGameInfo() will be called shortly after this function returns by the caller
    }
    return isOver;
}


// --- UI Rendering Functions ---
function renderCard(card) {
    const cardEl = document.createElement('div');
    cardEl.classList.add('card', `suit-${card.suit}`);
    cardEl.innerHTML = `${card.rank}<br>${card.suit}`;
    cardEl.dataset.rank = card.rank;
    cardEl.dataset.suit = card.suit;
    return cardEl;
}

function renderPlayerHand() {
    playerHandEl.innerHTML = ''; // Clear current hand display
    playerHand.forEach((card, index) => {
        const cardEl = renderCard(card);
        cardEl.dataset.index = index; // Store index for click handling

        // Reset classes first
        cardEl.classList.remove('disabled', 'selected', 'discard-selection');

        if (isDiscarding) {
            // --- Discard Mode ---
            cardEl.classList.add('discard-selection');
            if (selectedDiscardIndices.includes(index)) {
                cardEl.classList.add('selected');
            }
            cardEl.addEventListener('click', handleDiscardSelectionClick);
        } else {
            // --- Normal Play Mode ---
            const disableCard = gameOver || actionInProgress || (gameMode === 'online' && !isPlayerTurn) || (gameMode === 'ai' && !isPlayerTurn);
            if (disableCard) {
                cardEl.classList.add('disabled');
            } else {
                cardEl.addEventListener('click', handlePlayerCardClick);
            }
        }
        playerHandEl.appendChild(cardEl);
    });
    playerCardCountEl.textContent = playerHand.length; // Update count display
}

function renderOpponentHand() {
    opponentHandEl.innerHTML = ''; // Clear previous display

    if (gameMode === 'ai') {
        // Standard AI Mode: Render card backs
        opponentCardCountEl.textContent = opponentHand.length; // Use actual AI hand length
        for (let i = 0; i < opponentHand.length; i++) {
            const cardBack = document.createElement('div');
            cardBack.classList.add('card-back');
            opponentHandEl.appendChild(cardBack);
        }
    } else if (gameMode === 'online') {
        // Online Mode: Render card backs based on count received from server
        opponentCardCountEl.textContent = opponentCardCount; // Use the count variable
        for (let i = 0; i < opponentCardCount; i++) {
            const cardBack = document.createElement('div');
            cardBack.classList.add('card-back');
            opponentHandEl.appendChild(cardBack);
        }
    } else {
        opponentCardCountEl.textContent = '0';
    }
}

function updateGameInfo() {
    // Update health, deck, discard etc.
    playerHealthEl.textContent = Math.max(0, playerHealth);
    opponentHealthEl.textContent = Math.max(0, opponentHealth);

    // Deck count depends on mode
    deckCountEl.textContent = (gameMode === 'ai') ? deck.length : deckCountFromServer;

    // Discard count and top card
    discardCountEl.textContent = discardPile.length;
    discardTopEl.innerHTML = '';
     if (discardPile.length > 0) {
         const topCard = discardPile[discardPile.length - 1];
         if (topCard && topCard.rank && topCard.suit) { // Check card validity
            discardTopEl.innerHTML = `(<span class="suit-${topCard.suit}">${topCard.rank}${topCard.suit}</span>)`;
         } else {
             console.warn("Invalid card found on discard pile during render:", topCard);
         }
     }

    // Display the current game message
    messageAreaEl.textContent = gameMessage;

    // Update names
    playerNameH2.textContent = playerName;
    opponentNameH2.textContent = opponentName;

    // Render hands (which now clears correctly on game over via state change)
    renderPlayerHand();
    renderOpponentHand();

    // Update discard button state
    if (isDiscarding) {
        discardButton.style.display = 'inline-block';
        discardButton.disabled = selectedDiscardIndices.length !== requiredDiscardCount;
    } else {
        discardButton.style.display = 'none';
        discardButton.disabled = true;
    }

    // Update other buttons based on mode and game state
    restartButton.style.display = (gameMode === 'ai' && gameOver) ? 'block' : 'none';
    leaveOnlineButton.style.display = (gameMode === 'online' && !gameOver) ? 'block' : 'none';
    // Change leave button text after game over
    if (gameMode === 'online' && gameOver) {
         leaveOnlineButton.textContent = "Back to Menu";
         leaveOnlineButton.style.display = 'block'; // Ensure it's visible
    } else if (gameMode === 'online') {
         leaveOnlineButton.textContent = "Leave Game"; // Reset text if game somehow restarts
    }
}


// --- Discard Selection Logic (Visual) ---
function handleDiscardSelectionClick(event) {
    if (!isDiscarding) return;

    const cardIndex = parseInt(event.target.closest('.card').dataset.index);
     // Validate index
    if (isNaN(cardIndex) || cardIndex < 0 || cardIndex >= playerHand.length) {
         console.error("Invalid card index clicked for discard:", cardIndex);
         return;
     }

    const alreadySelected = selectedDiscardIndices.includes(cardIndex);

    if (alreadySelected) {
        selectedDiscardIndices = selectedDiscardIndices.filter(i => i !== cardIndex);
    } else {
        if (selectedDiscardIndices.length < requiredDiscardCount) {
            selectedDiscardIndices.push(cardIndex);
        }
    }
    setGameMessage(`Select ${requiredDiscardCount - selectedDiscardIndices.length} more card(s) to discard. (${selectedDiscardIndices.length}/${requiredDiscardCount})`, true);
    updateGameInfo(); // Update selection visuals and button state
}

function handleConfirmDiscardClick() {
    if (!isDiscarding || selectedDiscardIndices.length !== requiredDiscardCount) return;

    // Validate selected indices before proceeding (safety)
     for (const index of selectedDiscardIndices) {
         if (isNaN(index) || index < 0 || index >= playerHand.length) {
             console.error("Confirm Discard Error: Invalid index in selection array:", index, selectedDiscardIndices);
             setGameMessage("Error in card selection. Please try again.", true);
             // Reset selection?
             // selectedDiscardIndices = [];
             // updateGameInfo();
             return;
         }
     }

    // Sort indices descending for safe splicing
    selectedDiscardIndices.sort((a, b) => b - a);

    if (gameMode === 'ai') {
        // AI Mode: Process discard locally and resolve promise
        let discardedCardsForMessage = [];
        for (const index of selectedDiscardIndices) {
            // Double check index validity
            if (index >= 0 && index < playerHand.length) {
                const discardedCard = playerHand.splice(index, 1)[0];
                discardPile.push(discardedCard);
                discardedCardsForMessage.push(`${discardedCard.rank}${discardedCard.suit}`);
            } else {
                 console.error("AI Mode: Invalid index found during confirm discard splice:", index);
            }
        }
         // Reset discard state for AI mode
        isDiscarding = false;
        requiredDiscardCount = 0;
        actionInProgress = false; // Release lock held by initiatePlayerDiscard

        setGameMessage(`You discarded ${discardedCardsForMessage.length} card(s): ${discardedCardsForMessage.join(', ')}.`, true);

        if (discardCompletionCallback) {
            discardCompletionCallback(); // Signal completion for AI mode await
            discardCompletionCallback = null;
        }
    } else if (gameMode === 'online') {
        // Online Mode: Send selection to server
        setGameMessage("Sending discard selection...", true);
        sendWebSocketMessage({ type: 'DISCARD_CARDS', indices: selectedDiscardIndices });
        // Server response (GAME_UPDATE) will update the UI and state.
        // Resetting discard state happens when GAME_UPDATE is received or discard fails
         isDiscarding = false; // Optimistically reset UI state
         requiredDiscardCount = 0;
         actionInProgress = false; // Unlock action temporarily
    }

     selectedDiscardIndices = []; // Clear selection array
     updateGameInfo(); // Update UI (hide button, remove selection etc)
}

// Initiate visual discard process
function initiatePlayerDiscard(count, reason) {
    // For AI mode, it returns a promise.
    // For Online mode, it just sets up the UI.

    return new Promise(resolve => {
        if (playerHand.length === 0 || count <= 0) {
            setGameMessage("No cards to discard.", true);
            if (gameMode === 'ai') resolve(); // Resolve immediately for AI if nothing to do
            return;
        }

        const actualDiscardCount = Math.min(count, playerHand.length);

        // Auto-discard if necessary
        if (actualDiscardCount >= playerHand.length) {
            setGameMessage(`${reason} You must discard all ${playerHand.length} cards. Discarding...`, true);
            actionInProgress = true; // Lock briefly
            updateGameInfo(); // Show message

            setTimeout(() => { // Delay to allow message reading
                let discardedCardsForMessage = [];
                // Create indices [N-1, N-2, ..., 0] for safe splicing from end
                const indicesToDiscardDesc = [...Array(playerHand.length).keys()].reverse();

                if (gameMode === 'ai') {
                     for (const index of indicesToDiscardDesc) {
                        if (index >= 0 && index < playerHand.length) {
                            const card = playerHand.splice(index, 1)[0];
                            discardPile.push(card);
                            discardedCardsForMessage.push(`${card.rank}${card.suit}`);
                        }
                    }
                     setGameMessage(`Automatically discarded all cards: ${discardedCardsForMessage.reverse().join(', ')}.`, true); // Reverse for display order
                     actionInProgress = false; // Unlock
                     updateGameInfo();
                     resolve(); // Resolve the promise for AI mode
                } else if (gameMode === 'online') {
                     // Send original indices [0, 1, ..., N-1] to server
                     const indicesToSend = indicesToDiscardDesc.slice().reverse();
                     setGameMessage(`Automatically discarding all cards (sending to server)...`, true);
                     sendWebSocketMessage({ type: 'DISCARD_CARDS', indices: indicesToSend });
                     isDiscarding = false; // Exit discard mode UI-wise
                     actionInProgress = false; // Unlock action lock
                     updateGameInfo();
                     // Online mode doesn't use the promise resolve here.
                }
            }, 1500);
            return; // Stop here for auto-discard
        }

        // --- Manual Selection Setup ---
        isDiscarding = true;
        actionInProgress = true; // Lock game during selection
        requiredDiscardCount = actualDiscardCount;
        selectedDiscardIndices = [];
        if(gameMode === 'ai') {
            discardCompletionCallback = resolve; // Store resolve for AI mode promise
        }

        setGameMessage(`${reason} Select ${requiredDiscardCount} card(s) to discard, then click 'Discard Selected'. (0/${requiredDiscardCount})`, true);
        updateGameInfo(); // Show discard button, enable selection visuals
    });
}


// --- Event Handlers ---
function handleModeSelection(event) {
    const mode = event.target.id === 'play-ai-button' ? 'ai' : 'online';
    modeSelectionDiv.style.display = 'none'; // Hide mode selection

    if (mode === 'ai') {
        gameMode = 'ai';
        opponentName = "AI";
        playerName = "You"; // Reset to default for AI
        gameContainerDiv.style.display = 'flex'; // Show game board
        initAIGame();
    } else {
        gameMode = 'online';
        onlineSetupDiv.style.display = 'block'; // Show online setup
        // Reset previous game elements if any
        resetGameVisuals(); // Clear board before potential connection
    }
}

function handleJoinGame() {
    const name = playerNameInput.value.trim();
    if (!name) {
        connectionStatusP.textContent = "Please enter a name.";
        return;
    }
    playerName = name; // Set player name for display
    playerNameH2.textContent = playerName; // Update immediately
    joinGameButton.disabled = true;
    playerNameInput.disabled = true;
    connectionStatusP.textContent = `Connecting as ${playerName}...`;
    connectWebSocket();
}

function handlePlayerCardClick(event) {
    // Prevent action if not player's turn, game over, action in progress, or discarding
    const isNotPlayerTurn = (gameMode === 'online' && !isPlayerTurn) || (gameMode === 'ai' && !isPlayerTurn);
    if (gameOver || actionInProgress || isDiscarding || isNotPlayerTurn) {
        console.log("Card play prevented:", { gameOver, actionInProgress, isDiscarding, isPlayerTurn: isPlayerTurn, gameMode });
        return;
    }

    const cardElement = event.target.closest('.card');
    if (!cardElement) return; // Click wasn't on a card

    const cardIndex = parseInt(cardElement.dataset.index);
    // Validate index
     if (isNaN(cardIndex) || cardIndex < 0 || cardIndex >= playerHand.length) {
         console.error("Invalid card index clicked:", cardIndex);
         return;
     }
    const playedCard = playerHand[cardIndex];

    if (!playedCard) {
        console.error("Clicked card data not found in hand at index:", cardIndex);
        return;
    }

    actionInProgress = true; // Lock action

    if (gameMode === 'ai') {
        // --- AI Mode: Process locally ---
        setGameMessage("Processing your move...", true);
        // Immediately remove card visually for responsiveness
        playerHand.splice(cardIndex, 1);
        discardPile.push(playedCard); // Add to discard *before* applying effect in this flow
        updateGameInfo(); // Show card removed/discard updated

        applyCardEffectAI(playedCard, playerHand, opponentHand, true) // Apply effect (might await discard)
            .then(() => {
                // Check limit only if discard wasn't just handled
                if (!isDiscarding) {
                    return checkHandLimitAI(playerHand, true);
                }
             })
            .then(() => {
                // Check game over after all immediate consequences resolve
                updateGameInfo(); // Update after potential limit discard
                if (!checkGameOverAI()) {
                    // If game not over, switch to AI turn
                    isPlayerTurn = false;
                    // aiTurn() will handle the start of the AI's turn, including message and update
                    setTimeout(aiTurn, 1000); // AI takes turn after a delay
                } else {
                    updateGameInfo(); // Ensure final game over state is rendered
                }
            })
            .catch(error => {
                console.error("Error during player turn (AI Mode):", error);
                // Attempt to unlock safely
                if (!isDiscarding) actionInProgress = false;
                updateGameInfo();
            });

    } else if (gameMode === 'online') {
        // --- Online Mode: Send to server ---
        setGameMessage("Sending move...", true);
        updateGameInfo(); // Re-render hand immediately to show disabled state
        sendWebSocketMessage({ type: 'PLAY_CARD', card: playedCard });
        // Server response (GAME_UPDATE) will update the UI and state.
    }
}

function handleRestartClick() {
    if (gameMode === 'ai') {
        initAIGame(); // Re-initialize AI game
    }
}

function handleLeaveOnlineClick() {
    console.log("Leave online game clicked.");
    // Regardless of connection state, go back to menu
    resetToModeSelection("Left online game.");
    // ws.close() is handled within resetToModeSelection if ws exists
}

// --- WebSocket Functions ---
function connectWebSocket() {
    // ** IMPORTANT: Replace YOUR-PROJECT-NAME with your actual Glitch project name! **
    const wsUrl = `wss://jagged-ivy-biplane.glitch.me`; // Replace YOUR-PROJECT-NAME !
    console.log(`Attempting to connect to: ${wsUrl}`);
    setGameMessage(`Connecting to server...`, true);
    connectionStatusP.textContent = `Connecting...`;

    try {
         ws = new WebSocket(wsUrl);
         ws.onopen = handleWebSocketOpen;
         ws.onmessage = handleWebSocketMessage;
         ws.onerror = handleWebSocketError;
         ws.onclose = handleWebSocketClose;
    } catch (error) {
        console.error("WebSocket connection failed:", error);
         connectionStatusP.textContent = "Connection failed. Check URL/Server & refresh.";
         joinGameButton.disabled = false;
         playerNameInput.disabled = false;
    }
}

function sendWebSocketMessage(messageObject) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        try {
            ws.send(JSON.stringify(messageObject));
            console.log("Message sent:", messageObject); // Log sent messages
        } catch (error) {
            console.error("Error sending WebSocket message:", error);
        }
    } else {
        console.warn("WebSocket not open. Message not sent:", messageObject);
        setGameMessage("Connection issue. Cannot send message.", true);
    }
}

function handleWebSocketOpen() {
    console.log("WebSocket connection established.");
    connectionStatusP.textContent = "Connected! Sending join request...";
    sendWebSocketMessage({ type: 'JOIN', name: playerName });
}

function handleWebSocketMessage(event) {
    try {
        const message = JSON.parse(event.data);
        console.log("Message received:", message); // Log all received messages

        // Process message based on type
        switch (message.type) {
            case 'CONNECTED': // Server confirms connection
                playerId = message.playerId;
                console.log("Client ID set by server:", playerId);
                connectionStatusP.textContent = "Connected! Waiting for opponent...";
                break;

            case 'WAITING':
                connectionStatusP.textContent = message.message || "Waiting for an opponent...";
                break;

            case 'GAME_START':
                // Server sends initial state for online game
                onlineSetupDiv.style.display = 'none';
                gameContainerDiv.style.display = 'flex';
                gameOver = false;
                actionInProgress = false;
                isDiscarding = false;
                playerId = message.playerId;
                opponentName = message.opponentName;
                playerHand = message.hand || [];
                playerHealth = message.playerHealth;
                opponentHealth = message.opponentHealth;
                opponentCardCount = message.opponentCardCount;
                discardPile = message.discardPile || [];
                deckCountFromServer = message.deckCount || 0;
                isPlayerTurn = message.isYourTurn;
                const startMsg = message.message || (isPlayerTurn ? "Game started! Your turn." : `Game started! Waiting for ${opponentName}.`);
                setGameMessage(startMsg, false); // Update state but defer UI update
                updateGameInfo(); // Initial render

                 // If it's our turn, request the appropriate draw
                 if (isPlayerTurn) {
                    const drawCount = playerHand.length === 0 ? 5 : 1;
                    const drawMsg = drawCount === 5 ? "Hand empty, drawing 5 cards..." : "Drawing 1 card...";
                     console.log(`Client: Starting online game turn. Requesting draw ${drawCount}.`);
                     setGameMessage(drawMsg, true); // Show drawing message
                     actionInProgress = true; // Lock actions
                     sendWebSocketMessage({ type: 'REQUEST_DRAW', count: drawCount });
                     updateGameInfo(); // Re-render to show message/lock state
                 }
                break;

            case 'GAME_UPDATE':
                // Server sends updated state after an action
                playerHealth = message.playerHealth;
                opponentHealth = message.opponentHealth;
                 // Only update hand if server explicitly sends it in the update
                 if (message.hand) {
                     playerHand = message.hand;
                 }
                opponentCardCount = message.opponentCardCount;
                discardPile = message.discardPile || discardPile;
                deckCountFromServer = message.deckCount !== undefined ? message.deckCount : deckCountFromServer;
                const wasMyTurnBeforeUpdate = isPlayerTurn; // Store previous turn state
                isPlayerTurn = message.isYourTurn;

                 // Set message state, but update UI below
                 if (message.message) {
                     setGameMessage(message.message, false);
                 } else if (!isDiscarding) { // Avoid overwriting discard prompts
                     setGameMessage(isPlayerTurn ? "Your turn." : `Waiting for ${opponentName}...`, false);
                 }

                actionInProgress = false; // Unlock actions after receiving update
                isDiscarding = false; // Assume discard ends unless server sends DISCARD_REQUIRED again
                updateGameInfo(); // Update entire UI with new state

                 // Check if it JUST became our turn (and we're not currently discarding)
                 if (!wasMyTurnBeforeUpdate && isPlayerTurn && !isDiscarding) {
                    const drawCount = playerHand.length === 0 ? 5 : 1;
                    const drawMsg = drawCount === 5 ? "Hand empty, drawing 5 cards..." : "Drawing 1 card...";

                     console.log(`Client: Just became my turn. Requesting draw ${drawCount}.`);
                     setGameMessage(drawMsg, true); // Show drawing message
                     actionInProgress = true; // Lock actions while waiting for draw response
                     sendWebSocketMessage({ type: 'REQUEST_DRAW', count: drawCount });
                     updateGameInfo(); // Re-render to show message/lock state
                 }
                break;

             case 'OPPONENT_ACTION': // Informational message
                 setGameMessage(message.message, true);
                 // GAME_UPDATE likely follows shortly after
                 break;

             case 'DISCARD_REQUIRED': // Server explicitly requires discard
                  // Ensure we are not already processing an action
                  actionInProgress = false; // Allow discard initiation
                 initiatePlayerDiscard(message.count, message.reason);
                 // initiatePlayerDiscard sets actionInProgress=true and handles UI
                 break;

            case 'GAME_OVER': // WITH HAND CLEAR FIX
                gameOver = true;
                actionInProgress = false;
                isDiscarding = false;
                isPlayerTurn = false;

                const gameOverMsgText = message.message || "Game Over!";

                // --- FIX: Determine loser and clear their display ---
                let playerLost = false;
                let opponentLost = false;
                if (gameOverMsgText.includes("wins!")) {
                    if (!gameOverMsgText.includes(playerName + " wins!")) playerLost = true;
                    if (!gameOverMsgText.includes(opponentName + " wins!")) opponentLost = true;
                } else if (gameOverMsgText.toLowerCase().includes("draw")) {
                     playerLost = true; opponentLost = true; // Clear both on draw
                } else {
                     console.warn("Could not determine winner from game over message:", gameOverMsgText);
                     playerLost = true; opponentLost = true; // Clear both if unsure
                }

                if (playerLost) {
                    playerHand = []; // Clear player's logical hand state
                    console.log("Clearing player hand display on loss/draw.");
                }
                if (opponentLost) {
                    opponentCardCount = 0; // Clear opponent's logical card count state
                    console.log("Clearing opponent card count display on loss/draw.");
                }
                // --- End Fix ---

                setGameMessage(gameOverMsgText, true); // Set message *after* potentially clearing state
                updateGameInfo(); // Update UI to show cleared hands/counts
                leaveOnlineButton.style.display = 'block';
                leaveOnlineButton.textContent = "Back to Menu";
                break;

            case 'PLAYER_DISCONNECTED':
                gameOver = true; // Treat disconnect as game over
                actionInProgress = false;
                isDiscarding = false;
                isPlayerTurn = false;
                setGameMessage(`${message.message || opponentName + ' disconnected.'} Game ended.`, true);
                updateGameInfo();
                leaveOnlineButton.textContent = "Back to Menu";
                leaveOnlineButton.style.display = 'block';
                if (ws) ws.close();
                break;

            case 'LEFT_GAME': // Confirmation from server that we left
                 setGameMessage(message.message || "You left the game.", true);
                 resetToModeSelection(message.message || "You left the game.");
                 break;

            case 'ERROR':
                 console.error("Error from server:", message.message);
                 setGameMessage(`Server Error: ${message.message}`, true);
                 if (message.unlockAction) { // Server might indicate action can be retried
                    actionInProgress = false;
                     isDiscarding = false; // Also ensure discard state is reset on error
                    updateGameInfo();
                 }
                 break;

             default:
                 console.warn("Unknown message type received:", message.type, message);
        }

    } catch (error) {
        console.error("Error processing WebSocket message:", error);
        setGameMessage("Error receiving data from server.", true);
    }
}

function handleWebSocketError(event) {
    console.error("WebSocket error:", event);
    const errorMsg = "Connection error. Please check console (F12) & refresh.";
     if(gameMode === 'online' && !gameOver) {
        setGameMessage(errorMsg, true);
        gameOver = true; // Assume game over on error
        actionInProgress = false;
        isDiscarding = false;
        updateGameInfo();
        leaveOnlineButton.textContent = "Back to Menu";
        leaveOnlineButton.style.display = 'block';
     } else {
         connectionStatusP.textContent = errorMsg;
         joinGameButton.disabled = false;
         playerNameInput.disabled = false;
     }
     // Ensure state reset on error
     actionInProgress = false;
     isDiscarding = false;
}

function handleWebSocketClose(event) {
    console.log("WebSocket connection closed.", event.code, event.reason);
    const closeMsg = "Connection closed.";
     if(gameMode === 'online' && !gameOver) {
        // If game was in progress, treat as disconnect unless already game over
        setGameMessage( event.reason || closeMsg + " Game may have ended.", true);
        gameOver = true;
        actionInProgress = false;
        isPlayerTurn = false;
        isDiscarding = false;
        updateGameInfo();
         leaveOnlineButton.textContent = "Back to Menu";
         leaveOnlineButton.style.display = 'block';
     } else if (gameMode === 'online') {
        // If closed during setup or after game over
         connectionStatusP.textContent = event.reason || closeMsg;
         if (!gameOver) { // If closed during setup, re-enable join
             joinGameButton.disabled = false;
             playerNameInput.disabled = false;
         }
     }
    ws = null;
}

// --- AI Mode Specific Functions ---
function initAIGame() {
    console.log("Initializing AI Game...");
    gameMode = 'ai';
    opponentName = "AI";
    playerName = "You";
    gameOver = false;
    actionInProgress = false;
    isDiscarding = false;
    playerHealth = STARTING_HEALTH;
    opponentHealth = STARTING_HEALTH;
    playerHand = [];
    opponentHand = []; // AI's actual hand
    discardPile = [];
    deck = createDeck();
    shuffleDeck(deck);

    // Deal initial hands
    drawCardFromLocalDeck(playerHand, STARTING_HAND_SIZE);
    drawCardFromLocalDeck(opponentHand, STARTING_HAND_SIZE);

    isPlayerTurn = true; // Player always starts vs AI

    setGameMessage("", false); // Clear message initially
    restartButton.style.display = 'none';
    leaveOnlineButton.style.display = 'none';
    updateGameInfo(); // Render initial state

    // Start the first turn (player draw phase)
    startPlayerTurnAI();
}

// Function to handle the start of the player's turn against the AI
async function startPlayerTurnAI() {
    if (gameOver || !isPlayerTurn || gameMode !== 'ai' || actionInProgress) return; // Extra safety

    actionInProgress = true; // Lock during draw phase

    // Check Empty Hand Rule
    if (playerHand.length === 0) {
        setGameMessage("Your hand is empty, drawing 5 cards.", true);
        await new Promise(resolve => setTimeout(resolve, 800)); // Pause for reading
        drawCardFromLocalDeck(playerHand, 5);
        setGameMessage("Drew 5 cards. Your turn. Play a card.", true);
    } else {
        // Normal Draw
        setGameMessage("Drawing 1 card...", true);
        await new Promise(resolve => setTimeout(resolve, 600)); // Pause for reading
        drawCardFromLocalDeck(playerHand, 1);
        setGameMessage("Your turn. Play a card.", true);
    }

    // Check hand limit *after* drawing in AI mode
    await checkHandLimitAI(playerHand, true);

    // Unlock only if not forced to discard by hand limit check
    if (!isDiscarding) {
       actionInProgress = false;
    }
    updateGameInfo(); // Update UI with new hand/counts and enable controls if unlocked
}


async function aiTurn() {
    if (gameOver || actionInProgress || isDiscarding || gameMode !== 'ai') return;

    actionInProgress = true; // Lock during AI turn
    setGameMessage("AI's Turn...", true);
    updateGameInfo(); // Disable player controls visually
    await new Promise(resolve => setTimeout(resolve, 500)); // Small pause

    // --- AI Draw Phase ---
    if (opponentHand.length === 0) {
        setGameMessage("AI has no cards, drawing 5.", true);
        await new Promise(resolve => setTimeout(resolve, 800));
        drawCardFromLocalDeck(opponentHand, STARTING_HAND_SIZE);
    } else {
        setGameMessage("AI draws a card.", true);
        await new Promise(resolve => setTimeout(resolve, 800));
        drawCardFromLocalDeck(opponentHand, 1);
    }
    updateGameInfo(); // Show updated AI hand count/backs
    await new Promise(resolve => setTimeout(resolve, 500));


    // --- AI Action Phase ---
    if (opponentHand.length === 0) {
        setGameMessage("AI has no cards to play. Passing turn.", true);
        await new Promise(resolve => setTimeout(resolve, 800));
        actionInProgress = false; // Unlock if passing immediately
    } else {
        const cardToPlayIndex = chooseAICard();
        // Validate index
        if (cardToPlayIndex < 0 || cardToPlayIndex >= opponentHand.length) {
            console.error("AI chose invalid card index:", cardToPlayIndex, "Hand size:", opponentHand.length);
            setGameMessage("AI Error: Could not choose card. Passing turn.", true);
            actionInProgress = false; // Unlock on error
        } else {
            const playedCard = opponentHand[cardToPlayIndex];
            setGameMessage(`AI considers playing ${playedCard.rank}${playedCard.suit}...`, true);
            await new Promise(resolve => setTimeout(resolve, 1200));

            // Remove card from AI hand and add to discard *before* applying effect
            opponentHand.splice(cardToPlayIndex, 1);
            discardPile.push(playedCard);
            updateGameInfo(); // Show card removed from AI count / added to discard

            // Apply effect (this function handles awaits internally, including player discard)
            await applyCardEffectAI(playedCard, opponentHand, playerHand, false);

            // Check AI hand limit AFTER effect resolves (applyCardEffectAI might have unlocked actionInProgress if player discarded)
            if(!isDiscarding && !actionInProgress) actionInProgress = true; // Ensure lock before checkHandLimit if needed
            await checkHandLimitAI(opponentHand, false);

             // Ensure lock is released if no hand limit discard happened for AI and not waiting for player discard
             if (!isDiscarding && actionInProgress) {
                actionInProgress = false;
             }
        }
    }

    // --- End AI Turn ---
    updateGameInfo(); // Update state before check game over

    if (!checkGameOverAI()) {
        isPlayerTurn = true;
        // --- !!! CALL startPlayerTurnAI to handle player's draw phase !!! ---
        startPlayerTurnAI();
    } else {
         updateGameInfo(); // Ensure final game over state is shown
    }
}

function chooseAICard() {
     // If AI has no cards, return invalid index
     if(opponentHand.length === 0) return -1;

     // Simple AI Strategy
     let bestCardIndex = 0;
     const options = opponentHand.map((card, index) => {
         let score = 0;
         switch (card.suit) {
             case '♠': // Attack
                 if (playerHealth - card.value <= 0) score = 100; // Winning move
                 else score = 20 + card.value;
                 break;
             case '♥': // Heal
                 if (opponentHealth <= 5 && opponentHealth < MAX_HEALTH) score = 50 + card.value; // Urgent heal
                 else if (opponentHealth < MAX_HEALTH / 2 && opponentHealth < MAX_HEALTH) score = 15 + card.value;
                 else if (opponentHealth < MAX_HEALTH) score = 5 + card.value; // Only heal if not full
                 else score = -5; // Penalize healing at full health
                 break;
             case '♣': // Disrupt
                 if (playerHand.length >= 4) score = 10 + card.value; // Good disruption
                 else if (playerHand.length > 1) score = 5 + card.value;
                 else score = 1; // Low priority if player has few cards
                 break;
             case '♦': // Draw
                 if (opponentHand.length >= MAX_HAND_SIZE) score = -10; // Penalize drawing at max hand size
                 else if (opponentHand.length <= 2) score = 18 + card.value; // Need cards badly
                 else if (opponentHand.length < 5) score = 8 + card.value;
                 else score = 2 + card.value; // Lower priority draw otherwise
                 break;
         }
          score += card.value * 0.1; // Slight bonus for higher value cards in general
          if(card.rank === 'A') score -= 1; // Slightly penalize low value ace

          return { index, score, card };
     });

     options.sort((a, b) => b.score - a.score);

     // Log AI decision making
     // console.log("AI Hand:", opponentHand.map(c=>c.rank+c.suit).join(', '));
     // console.log("AI Choices (Top 3):", options.slice(0, 3).map(o => `${o.card.rank}${o.card.suit} (${o.score.toFixed(1)})`).join(', '));

     bestCardIndex = options[0].index;
     // console.log("AI Playing:", options[0].card.rank + options[0].card.suit);
     return bestCardIndex;
}


// --- Initialization and Reset ---

// Helper to just clear the visual board elements
function resetGameVisuals() {
     playerHand = [];
     opponentHand = [];
     opponentCardCount = 0;
     discardPile = [];
     playerHealth = STARTING_HEALTH;
     opponentHealth = STARTING_HEALTH;
     deck = [];
     deckCountFromServer = 0;
     gameOver = false;
     actionInProgress = false;
     isDiscarding = false;
     isPlayerTurn = true; // Default assumption before game starts
     updateGameInfo(); // Render the cleared state
}

function resetToModeSelection(message = "Choose a game mode.") {
    console.log("Resetting to mode selection...");
    // Hide game areas, show mode selection
    gameContainerDiv.style.display = 'none';
    onlineSetupDiv.style.display = 'none';
    modeSelectionDiv.style.display = 'block';

    // Reset state variables fully
    gameMode = null;
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close(); // Close connection if returning to menu
    }
    ws = null;
    playerName = "You";
    opponentName = "Opponent";
    playerId = null;
    // Clear game state vars
    deck = [];
    discardPile = [];
    playerHand = [];
    opponentHand = [];
    opponentCardCount = 0;
    playerHealth = STARTING_HEALTH;
    opponentHealth = STARTING_HEALTH;
    isPlayerTurn = true;
    gameOver = false;
    gameMessage = message;
    actionInProgress = false;
    isDiscarding = false;
    requiredDiscardCount = 0;
    selectedDiscardIndices = [];
    discardCompletionCallback = null;
    deckCountFromServer = 0;

     // Reset UI elements specifically
     connectionStatusP.textContent = '';
     playerNameInput.value = '';
     joinGameButton.disabled = false;
     playerNameInput.disabled = false;
     setGameMessage(message, true); // Update message area directly
     resetGameVisuals(); // Ensure board is visually cleared too
}


function initializeApp() {
    console.log("Initializing Suit Duel App...");
    // Add initial event listeners
    playAiButton.addEventListener('click', handleModeSelection);
    playOnlineButton.addEventListener('click', handleModeSelection);
    joinGameButton.addEventListener('click', handleJoinGame);
    discardButton.addEventListener('click', handleConfirmDiscardClick);
    restartButton.addEventListener('click', handleRestartClick);
    leaveOnlineButton.addEventListener('click', handleLeaveOnlineClick);

    // Start at mode selection
    resetToModeSelection();
}

// --- Start the App ---
initializeApp();