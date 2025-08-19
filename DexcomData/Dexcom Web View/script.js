// First part of this file is under the below MIT license, rest of it is mine. There is a comment at the point where it changes from Brett Farrow's code to my code.

//MIT License
//
//Copyright (c) 2023 Brett Farrow
//
//Permission is hereby granted, free of charge, to any person obtaining a copy
//of this software and associated documentation files (the "Software"), to deal
//in the Software without restriction, including without limitation the rights
//to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
//copies of the Software, and to permit persons to whom the Software is
//furnished to do so, subject to the following conditions:
//
//The above copyright notice and this permission notice shall be included in all
//copies or substantial portions of the Software.
//
//THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
//AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
//LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
//SOFTWARE.

class GlucoseReading {
  constructor(jsonGlucoseReading) {
    this.value = jsonGlucoseReading.Value;
    this.mgdL = this.value;
    this.mmolL = parseFloat((this.value * MMOL_L_CONVERTION_FACTOR).toFixed(1));
    this.trend = jsonGlucoseReading.Trend;
    if (typeof this.trend !== "number") {
      this.trend = DEXCOM_TREND_DIRECTIONS[this.trend] || 0;
    }
    this.trendDescription = DEXCOM_TREND_DESCRIPTIONS[this.trend];
    this.trendArrow = DEXCOM_TREND_ARROWS[this.trend];
    this.time = new Date(
      parseInt(jsonGlucoseReading.WT.replace(/[^0-9]/g, "") / 1000) * 1000,
    );

    // Drop the redundant timestamp fields
    delete jsonGlucoseReading.DT;
    delete jsonGlucoseReading.ST;
    // Allow access to raw JSON for serializing to file:
    this.json = jsonGlucoseReading;
  }
}

class Dexcom {
  constructor(username, password, ous = false) {
    this.baseURL = ous ? DEXCOM_BASE_URL_OUS : DEXCOM_BASE_URL;
    this.username = username;
    this.password = password;
    this.sessionId = null;
    this.accountId = null;
    this.createSession();
  }

  async _request(method, endpoint, params = {}, json = {}) {
    try {
      const url = `${this.baseURL}/${endpoint}`;
      const response = await fetch(url, {
        method: method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(params),
      });
      const jsonResponse = await response.json();
      if (!response.ok) {
        console.error(`json:`, jsonResponse);
        if (response.status === 500) {
          if (jsonResponse.Code === "SessionNotValid") {
            console.log("session not valid error being throw");
            throw new SessionError(SESSION_ERROR_SESSION_NOT_VALID);
          } else if (jsonResponse.Code === "sessionIdNotFound") {
            console.log("session id not found error being throw");
            throw new SessionError(SESSION_ERROR_SESSION_NOT_FOUND);
          } else if (jsonResponse.Code === "SSO_AuthenticateAccountNotFound") {
            throw new AccountError(ACCOUNT_ERROR_ACCOUNT_NOT_FOUND);
          } else if (jsonResponse.Code === "AccountPasswordInvalid") {
            throw new AccountError(ACCOUNT_ERROR_PASSWORD_INVALID);
          } else if (
            jsonResponse.Code === "SSO_AuthenticateMaxAttemptsExceeed"
          ) {
            throw new AccountError(ACCOUNT_ERROR_MAX_ATTEMPTS);
          } else if (jsonResponse.Code === "InvalidArgument") {
            if (jsonResponse.Message.includes("accountName")) {
              throw new AccountError(ACCOUNT_ERROR_USERNAME_NULL_EMPTY);
            } else if (jsonResponse.Message.includes("password")) {
              throw new AccountError(ACCOUNT_ERROR_PASSWORD_NULL_EMPTY);
            }
          } else {
            console.error(`${jsonResponse.Code}: ${jsonResponse.Message}`);
          }
        } else {
          console.error(`${response.status}:`, jsonResponse);
        }
      }
      return jsonResponse;
    } catch (error) {
      console.error(error);
    }
  }

  _validatesessionId() {
    if (!this.sessionId) {
      throw new SessionError(SESSION_ERROR_SESSION_ID_NULL);
    }
    if (this.sessionId === DEFAULT_SESSION_ID) {
      throw new SessionError(SESSION_ERROR_SESSION_ID_DEFAULT);
    }
  }

  _validateAccount() {
    if (!this.username) {
      console.error(ACCOUNT_ERROR_USERNAME_NULL_EMPTY);
      throw new AccountError(ACCOUNT_ERROR_USERNAME_NULL_EMPTY);
    }
    if (!this.password) {
      console.error(ACCOUNT_ERROR_PASSWORD_NULL_EMPTY);
      throw new AccountError(ACCOUNT_ERROR_PASSWORD_NULL_EMPTY);
    }
  }

  _validateAccountID() {
    if (!this.accountId) {
      console.error(SESSION_ERROR_ACCOUNT_ID_NULL_EMPTY);
      throw new AccountError(SESSION_ERROR_ACCOUNT_ID_NULL_EMPTY);
    }
    if (this.accountId == DEFAULT_SESSION_ID) {
      console.error(SESSION_ERROR_ACCOUNT_ID_DEFAULT);
      throw new AccountError(SESSION_ERROR_ACCOUNT_ID_DEFAULT);
    }
  }

  async createSession() {
    this._validateAccount();

    const json = {
      accountName: this.username,
      password: this.password,
      applicationId: DEXCOM_APPLICATION_ID,
    };

    try {
      const endpoint1 = DEXCOM_AUTHENTICATE_ENDPOINT;
      const endpoint2 = DEXCOM_LOGIN_ID_ENDPOINT;

      const accountId = await this._request("post", endpoint1, json);
      this.accountId = accountId;

      this._validateAccountID();

      const json2 = {
        accountId: this.accountId,
        password: this.password,
        applicationId: DEXCOM_APPLICATION_ID,
      };

      const sessionId = await this._request("post", endpoint2, json2);
      this.sessionId = sessionId;
      this._validatesessionId();
    } catch (error) {
      if (error instanceof SessionError) {
        throw new AccountError(ACCOUNT_ERROR_UNKNOWN);
      }
      throw error;
    }
  }

  async verifySerialNumber(serialNumber) {
    this._validatesessionId();
    if (!serialNumber) {
      throw new ArgumentError(ARGUMENT_ERROR_SERIAL_NUMBER_NULL_EMPTY);
    }
    const params = { sessionId: this.sessionId, serialNumber };
    try {
      const response = await this._request(
        "post",
        DEXCOM_VERIFY_SERIAL_NUMBER_ENDPOINT,
        { params },
      );
      return response.json() === "AssignedToYou";
    } catch (error) {
      if (error.message === SESSION_ERROR_SESSION_NOT_VALID) {
        this.createSession();
        const response = await this._request(
          "post",
          DEXCOM_VERIFY_SERIAL_NUMBER_ENDPOINT,
          { params },
        );
        return response.json() === "AssignedToYou";
      }
      throw error;
    }
  }

  async getGlucoseReadings(minutes = 1440, maxCount = 288) {
    try {
      this._validatesessionId();
    } catch (error) {
      await this.createSession();
    }

    if (minutes < 1 || minutes > 1440) {
      throw new ArgumentError(ARGUMENT_ERROR_MINUTES_INVALID);
    }

    if (maxCount < 1 || maxCount > 288) {
      throw new ArgumentError(ARGUMENT_ERROR_MAX_COUNT_INVALID);
    }

    const params = {
      sessionId: this.sessionId,
      minutes,
      maxCount,
    };

    try {
      const jsonGlucoseReadings = await this._request(
        "post",
        DEXCOM_GLUCOSE_READINGS_ENDPOINT,
        params,
      );
      const glucoseReadings = jsonGlucoseReadings.map(
        (jsonGlucoseReading) => new GlucoseReading(jsonGlucoseReading),
      );
      if (glucoseReadings.length === 0) {
        return null;
      }
      return glucoseReadings;
    } catch (error) {
      if (error instanceof SessionError) {
        this.createSession();
        const jsonGlucoseReadings = await this._request(
          "post",
          DEXCOM_GLUCOSE_READINGS_ENDPOINT,
          null,
          params,
        );
        const glucoseReadings = jsonGlucoseReadings.map(
          (jsonGlucoseReading) => new GlucoseReading(jsonGlucoseReading),
        );
        if (glucoseReadings.length === 0) {
          return null;
        }
        return glucoseReadings;
      }
      throw error;
    }
  }

  async getLatestGlucoseReading() {
    const glucoseReadings = await this.getGlucoseReadings(5, 1);
    if (!glucoseReadings) {
      return null;
    }
    return glucoseReadings[0];
  }

  async getCurrentGlucoseReading() {
    try {
      const glucoseReadings = await this.getGlucoseReadings(10, 1);
      if (!glucoseReadings || glucoseReadings.length === 0) {
        return null;
      }
      return glucoseReadings[0];
    } catch (error) {
      throw error;
    }
  }
}

// Dexcom Share API base urls
const DEXCOM_BASE_URL = "https://share2.dexcom.com/ShareWebServices/Services";
const DEXCOM_BASE_URL_OUS =
  "https://shareous1.dexcom.com/ShareWebServices/Services";

// Dexcom Share API endpoints
const DEXCOM_LOGIN_ID_ENDPOINT = "General/LoginPublisherAccountById";
const DEXCOM_AUTHENTICATE_ENDPOINT = "General/AuthenticatePublisherAccount";
const DEXCOM_VERIFY_SERIAL_NUMBER_ENDPOINT =
  "Publisher/CheckMonitoredReceiverAssignmentStatus";
const DEXCOM_GLUCOSE_READINGS_ENDPOINT =
  "Publisher/ReadPublisherLatestGlucoseValues";

const DEXCOM_APPLICATION_ID = "d89443d2-327c-4a6f-89e5-496bbb0317db";

// Dexcom error strings
const ACCOUNT_ERROR_USERNAME_NULL_EMPTY = "Username null or empty";
const ACCOUNT_ERROR_PASSWORD_NULL_EMPTY = "Password null or empty";
const SESSION_ERROR_ACCOUNT_ID_NULL_EMPTY = "Accound ID null or empty";
const SESSION_ERROR_ACCOUNT_ID_DEFAULT = "Accound ID default";
const ACCOUNT_ERROR_ACCOUNT_NOT_FOUND = "Account not found";
const ACCOUNT_ERROR_PASSWORD_INVALID = "Password not valid";
const ACCOUNT_ERROR_MAX_ATTEMPTS = "Maximum authentication attempts exceeded";
const ACCOUNT_ERROR_UNKNOWN = "Account error";

const SESSION_ERROR_SESSION_ID_NULL = "Session ID null";
const SESSION_ERROR_SESSION_ID_DEFAULT = "Session ID default";
const SESSION_ERROR_SESSION_NOT_VALID = "Session ID not valid";
const SESSION_ERROR_SESSION_NOT_FOUND = "Session ID not found";

const ARGUMENT_ERROR_MINUTES_INVALID = "Minutes must be between 1 and 1440";
const ARGUMENT_ERROR_MAX_COUNT_INVALID = "Max count must be between 1 and 288";
const ARGUMENT_ERROR_SERIAL_NUMBER_NULL_EMPTY = "Serial number null or empty";

// Other
const DEXCOM_TREND_DESCRIPTIONS = [
  "",
  "rising quickly",
  "rising",
  "rising slightly",
  "steady",
  "falling slightly",
  "falling",
  "falling quickly",
  "unable to determine trend",
  "trend unavailable",
];

const DEXCOM_TREND_DIRECTIONS = {
  None: 0,
  DoubleUp: 1,
  SingleUp: 2,
  FortyFiveUp: 3,
  Flat: 4,
  FortyFiveDown: 5,
  SingleDown: 6,
  DoubleDown: 7,
  NotComputable: 8,
  RateOutOfRange: 9,
};

const DEXCOM_TREND_ARROWS = ["", "↑↑", "↑", "↗", "→", "↘", "↓", "↓↓", "?", "-"];

const DEFAULT_SESSION_ID = "00000000-0000-0000-0000-000000000000";

const MMOL_L_CONVERTION_FACTOR = 0.0555;


class DexcomError extends Error {
  constructor(message) {
    super(message);
    this.name = "DexcomError";
  }
}

class AccountError extends DexcomError {
  constructor(message) {
    super(message);
    this.name = "AccountError";
  }
}

class SessionError extends DexcomError {
  constructor(message) {
    super(message);
    this.name = "SessionError";
  }
}

class ArgumentError extends DexcomError {
  constructor(message) {
    super(message);
    this.name = "ArgumentError";
  }
}

// END MIT LICENSE CODE, EVERYTHING FROM THIS LINE DOWN IS MY CODE

let glucoseHighTarget = 180

function setTarget160() {
    glucoseHighTarget = 160
}

function setTarget180() {
    glucoseHighTarget = 180
}

function setTarget200() {
    glucoseHighTarget = 200
}

const audio = new Audio("alert.wav")

let soundCounter = 60

let silent = false
let silentIterations = 0

function tempMute() {
    silent = true
    silentIterations = 0
}

function testSound() {
    audio.play()
}

async function getGlucoseData() {
  // API call
  const dexcom = new Dexcom("USERNAME", "PASSWORD");
  const glucoseReadings = await dexcom.getGlucoseReadings(200, 40);
    
//    silent mode countdown
    if (silent) {
        silentIterations += 1
    }
    
    if (silentIterations > 99) {
        silent = false
        silentIterations = 0
    }
    
//    sounds
    if (glucoseReadings[0].value > glucoseHighTarget - 1 || glucoseReadings[0].value < 76) {
        if (soundCounter === 60) {
            if (!silent) {
                audio.play()
            }
            soundCounter = 0
        } else {
            soundCounter += 1
        }
    } else {
        soundCounter = 60
    }
    
//    document.getElementById("debugger").innerText = soundCounter
    
//    render view
    
  // circles
  const circle1 = document.getElementById("circle1")
  const circle2 = document.getElementById("circle2")
  const circle3 = document.getElementById("circle3")
  const circle4 = document.getElementById("circle4")
  const circle5 = document.getElementById("circle5")
  const circle6 = document.getElementById("circle6")
  const circle7 = document.getElementById("circle7")
  const circle8 = document.getElementById("circle8")
  const circle9 = document.getElementById("circle9")
  const circle10 = document.getElementById("circle10")
  const trendArrow = document.getElementById("trend-arrow")

  circle1.style.background = returnColor(glucoseReadings[9].value)
  circle2.style.background = returnColor(glucoseReadings[8].value)
  circle3.style.background = returnColor(glucoseReadings[7].value)
  circle4.style.background = returnColor(glucoseReadings[6].value)
  circle5.style.background = returnColor(glucoseReadings[5].value)
  circle6.style.background = returnColor(glucoseReadings[4].value)
  circle7.style.background = returnColor(glucoseReadings[3].value)
  circle8.style.background = returnColor(glucoseReadings[2].value)
  circle9.style.background = returnColor(glucoseReadings[1].value)
  circle10.style.background = returnColor(glucoseReadings[0].value)
  trendArrow.innerText = glucoseReadings[0].trendArrow
    
//  document.getElementById("debugger").innerText = "circles rendered"

  // draw chart
  const detailsLeft = document.getElementById('details-left');
  detailsLeft.innerHTML = '<canvas id="myChart"></canvas>';
  const ctx = document.getElementById("myChart").getContext("2d")
  const chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [glucoseReadings[36].time, glucoseReadings[35].time, glucoseReadings[34].time, glucoseReadings[33].time, glucoseReadings[32].time, glucoseReadings[31].time, glucoseReadings[30].time, glucoseReadings[29].time, glucoseReadings[28].time, glucoseReadings[27].time, glucoseReadings[26].time, glucoseReadings[25].time, glucoseReadings[24].time, glucoseReadings[23].time, glucoseReadings[22].time, glucoseReadings[21].time, glucoseReadings[20].time, glucoseReadings[19].time, glucoseReadings[18].time, glucoseReadings[17].time, glucoseReadings[16].time, glucoseReadings[15].time, glucoseReadings[14].time, glucoseReadings[13].time, glucoseReadings[12].time, glucoseReadings[11].time, glucoseReadings[10].time, glucoseReadings[9].time, glucoseReadings[8].time, glucoseReadings[7].time, glucoseReadings[6].time, glucoseReadings[5].time, glucoseReadings[4].time, glucoseReadings[3].time, glucoseReadings[2].time, glucoseReadings[1].time, glucoseReadings[0].time],
      datasets: [{
        backgroundColor: 'rgb(100, 100, 100)',
        borderColor: 'rgb(200, 200, 200)',
        data: [glucoseReadings[36].value, glucoseReadings[35].value, glucoseReadings[34].value, glucoseReadings[33].value, glucoseReadings[32].value, glucoseReadings[31].value, glucoseReadings[30].value, glucoseReadings[29].value, glucoseReadings[28].value, glucoseReadings[27].value, glucoseReadings[26].value, glucoseReadings[25].value, glucoseReadings[24].value, glucoseReadings[23].value, glucoseReadings[22].value, glucoseReadings[21].value, glucoseReadings[20].value, glucoseReadings[19].value, glucoseReadings[18].value, glucoseReadings[17].value, glucoseReadings[16].value, glucoseReadings[15].value, glucoseReadings[14].value, glucoseReadings[13].value, glucoseReadings[12].value, glucoseReadings[11].value, glucoseReadings[10].value, glucoseReadings[9].value, glucoseReadings[8].value, glucoseReadings[7].value, glucoseReadings[6].value, glucoseReadings[5].value, glucoseReadings[4].value, glucoseReadings[3].value, glucoseReadings[2].value, glucoseReadings[1].value, glucoseReadings[0].value]
      }, {
          data: [...Array(156).keys()].map(x => 70),
          borderColor: 'rgb(255, 0, 0)',
          backgroundColor: 'rgb(255, 0, 0)',
        
      }, {
          data: [...Array(156).keys()].map(x => 180),
          borderColor: 'rgb(255, 255, 0)',
          backgroundColor: 'rgb(255, 255, 0)',
      }]
    },
    options: {
      scales: {
        y: {
          min: 40,
          max: 250
        },

        x: {
          ticks: false
        }
      }
    }
  })
    
    const detailsNum = document.getElementById("details-num")
    const detailsTrend = document.getElementById("details-trend")
    
    detailsNum.innerText = glucoseReadings[0].value
    detailsTrend.innerText = glucoseReadings[0].trendArrow
    
//    document.getElementById("debugger").innerText = "chart rendered"
    
// number view
  const numberViewNumber = document.getElementById("number")
  const numberViewTrend = document.getElementById("number-trend-arrow")

  numberViewNumber.innerText = glucoseReadings[0].value
  numberViewTrend.innerText = glucoseReadings[0].trendArrow
    
//  document.getElementById("debugger").innerText = "numbers rendered"
}

function returnColor(value) {
  console.log(value)
  if (value <= 70) {
    return "var(--under70)"
  } else if (value > 70 && value <= 80) {
    return "var(--under80)"
  } else if (value > 80 && value < 160) {
    return "var(--good)"
  } else if (value >= 160 && value < 180) {
    return "var(--over160)"
  } else if (value >= 180 && value < 250) {
    return "var(--over180)"
  } else if (value >= 250 && value < 300) {
    return "var(--over250)"
  } else if (value >= 300) {
    return "var(--over300)"
  }
}

// for web
//getGlucoseData()

// for app
getGlucoseData()
setInterval(getGlucoseData, 60000)
