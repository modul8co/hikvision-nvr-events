import { API, Logger, PlatformConfig, Service, Characteristic} from 'homebridge';
import { Parser } from 'xml2js';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class HikvisionNVREventsPlatform {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;
  private _urllib = require('urllib');
  private _requestOptions: { streaming: boolean; digestAuth: string };
  private _streamingOptions: { streaming: boolean; digestAuth: string };
  private _parser = new Parser({ explicitArray: false });
  private _channelNames = {};
  private _eventsUrl: string;
  private _channelsUrl: string;
  private _channelRegex = new RegExp('(?<=<dynChannelID>)\\d+');

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this._requestOptions = {
      streaming: false,
      digestAuth: `${config.username}:${config.password}`,
    };
    this._streamingOptions = {
      streaming: true,
      digestAuth: `${config.username}:${config.password}`,
    };
    this._eventsUrl = `http://${config.host}:${config.port}/ISAPI/Event/notification/alertStream`;
    log.debug('DVR Mode:', config.dvr);
    if(config.dvr) {
      this._channelsUrl = `http://${config.host}:${config.port}/ISAPI/System/Video/inputs/channels`;
    } else {
      this._channelsUrl = `http://${config.host}:${config.port}/ISAPI/ContentMgmt/InputProxy/channels`;
    }

    this.api.on('didFinishLaunching', () => {
      this.startListening();
    });
  }

  async startListening() {
    try {
      await this._urllib.request(this._channelsUrl, this._requestOptions).then((result) => {
        this._parser.parseString(result.data.toString(), (err, result)=> {
          if(this.config.dvr) {
            result.VideoInputChannelList.VideoInputChannel.forEach((channel) => {
              this._channelNames[channel.id] = channel.name;
              this.log.info(`Added camera ${channel.name} on channel ${channel.id}`);
            });
          } else {
            result.InputProxyChannelList.InputProxyChannel.forEach((channel) => {
              this._channelNames[channel.id] = channel.name;
              this.log.info(`Added camera ${channel.name} on channel ${channel.id}`);
            });
          }
        });
        this._urllib.request(this._eventsUrl, this._streamingOptions, this.responseHandler);
      });
    } catch (e) {
      this.log.error('Could not load channels', e);
    }
  }

  async motionUpdater(channel: string){
    try {
      await this._urllib.request(`${this.config.motionurl}?${channel}`).then((res) => {
        const resultObj = JSON.parse(res.data.toString());
        if(resultObj.error) {
          // eslint-disable-next-line max-len
          this.log.error('Failed to activate motion for', channel, resultObj.message, 'Please ensure that the name of the camera in your device matches the name of the camera in FFMPEG.');
        } else {
          this.log.info('Successfully activated motion for', channel, resultObj);
        }
      }).catch((e) => {
        this.log.error('Could not activate motion for channel', channel, e);
      });
    } catch (e) {
      this.log.error('There was a problem activating motion for', channel, e);
    }
  }

  responseHandler = (err, data, res) => {
    if (err) {
      this.log.error('Error:', err);
    }
    if (res !== null) {
      this.log.info('Listening for motion events on:', this._eventsUrl);
      res.on('data', (data) => {
        const channelMatches = data.toString().match(this._channelRegex);
        if (channelMatches !== null) {
          channelMatches.forEach((channelId) => {
            this.motionUpdater(this._channelNames[channelId]);
          });
        }
        if (data.includes('videoloss') && data.includes('inactive')) {
          this.log.debug('Heartbeat received from NVR/DVR');
        }
      });
      res.on('error', (err) => {
        this.log.error('Error', err);
      });
    }
  };

}
